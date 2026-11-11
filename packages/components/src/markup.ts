import type { InlineNode, PlaceholderType, Policy, Segment, SegmentDraft } from '@diglot/core'
import type { SourceMap } from 'magic-string'
import { buildSegment, prepareSegment, resolvePolicy, toSkeleton } from '@diglot/core'
import MagicString from 'magic-string'

export interface Span {
  start: number
  end: number
}

/** Text as the framework renders it, after its own whitespace rules. */
export interface TextNode extends Span {
  type: 'text'
  value: string
}

/** An expression whose value renders as text: `{{ x }}` in Vue, `{x}` in JSX and Svelte. */
interface ExpressionNode extends Span {
  type: 'expression'
  code: string
}

interface CommentNode extends Span {
  type: 'comment'
}

/** A static attribute such as `title="Close"`. */
export interface Attribute extends Span {
  name: string
  value: string
}

export interface ElementNode extends Span {
  type: 'element'
  name: string
  component: boolean
  /** Conditional, repeated, or with its content replaced, so it can't sit inside a sentence. */
  structural: boolean
  /** `translate="no"`, or the framework's own opt-out. */
  optOut: boolean
  /** The opening tag as written. */
  open: string
  /** The closing tag as written, empty for a self-closing element. */
  close: string
  attributes: Attribute[]
  children: MarkupNode[]
}

/** Control flow that renders other fragments: `{#if}` in Svelte, `{ok && <p />}` in JSX. */
export interface BlockNode extends Span {
  type: 'block'
  fragments: MarkupNode[][]
}

export type MarkupNode = TextNode | ExpressionNode | CommentNode | ElementNode | BlockNode

/** What renders in place of a placeholder: an expression, an element as written, or an element around the text it wraps. */
export type Part
  = | { type: 'expression', code: string }
    | { type: 'element', source: string }
    | { type: 'wrapper', open: string, close: string }

/** A run of text that renders through the runtime. `source` is its text as rendered, in placeholder form; `parts` are indexed by placeholder id. */
export interface Run extends Span {
  hash: string
  source: string
  parts: Part[]
}

/** How a framework writes runs and attributes back into its code. */
export interface Emitter {
  run: (run: Run) => string
  /** Returns `undefined` to leave the attribute as it is. */
  attribute: (attribute: Attribute, hash: string) => string | undefined
  /** Adds what the rewritten file needs, such as an import, once it has segments. */
  finish?: (s: MagicString) => void
}

export interface Parsed {
  nodes: MarkupNode[]
  emit: Emitter
}

export interface Skipped {
  line: number
  reason: string
  text: string
}

export interface Transformed {
  code: string
  map: SourceMap
  segments: Segment[]
  skipped: Skipped[]
}

/** Attributes that people read. */
const ATTRIBUTES = new Set(['title', 'alt', 'placeholder', 'label', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription'])

/** Phrasing elements and router links, which can sit inside a sentence and wrap part of it. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'label', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'RouterLink', 'router-link', 'NuxtLink', 'nuxt-link', 'Link'])

/** Elements that sit inside a sentence whole, content included. */
const OPAQUE = new Set(['br', 'wbr', 'img', 'code', 'kbd', 'samp', 'var', 'svg', 'math'])

/** Elements whose content is never translated. */
const SKIP = new Set(['script', 'style', 'pre', 'code', 'kbd', 'samp', 'var', 'svg', 'math', 'textarea'])

const CODE = new Set(['code', 'kbd', 'samp', 'var'])

/** Placeholder syntax that plain text can't contain without becoming ambiguous. */
const PLACEHOLDER_RE = /\{\/?\d+\}/

const LETTER_RE = /\p{L}/u
const URL_OR_EMAIL_RE = /\b(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+/g

/** Letters remain once URLs and email addresses are taken out. */
function hasLetters(text: string): boolean {
  return LETTER_RE.test(text.replace(URL_OR_EMAIL_RE, ''))
}

/** Kept whole as an atomic placeholder: opted out, code-like, empty, or a component that isn't a link. */
function isOpaque(element: ElementNode): boolean {
  return element.optOut || OPAQUE.has(element.name) || !element.children.length || (element.component && !INLINE.has(element.name))
}

function isInlineable(node: MarkupNode): boolean {
  if (node.type === 'block')
    return false
  if (node.type !== 'element')
    return true
  if (node.structural)
    return false
  if (node.optOut || OPAQUE.has(node.name))
    return true
  if (node.component && !INLINE.has(node.name))
    return !node.children.length
  return INLINE.has(node.name) && node.children.every(isInlineable)
}

function hasWords(nodes: MarkupNode[]): boolean {
  return nodes.some(node => node.type === 'text' ? hasLetters(node.value) : node.type === 'element' && !isOpaque(node) && hasWords(node.children))
}

function isEmpty(node: MarkupNode): boolean {
  return node.type === 'comment' || (node.type === 'text' && !node.value)
}

function placeholderType(element: ElementNode): PlaceholderType {
  if (element.component)
    return 'component'
  if (element.name === 'img')
    return 'image'
  return CODE.has(element.name) ? 'code' : 'html'
}

/**
 * Walks a parsed component: cuts its markup into runs of text, makes each run and each readable
 * attribute a segment, and rewrites them with the framework's emitter. The rules live here once:
 * what counts as text, which elements sit inside a sentence, where a sentence ends and what opts out.
 */
export function transformMarkup(code: string, file: string, parsed: Parsed, policy?: Partial<Policy>): Transformed {
  const { nodes: root, emit } = parsed
  const resolved = resolvePolicy(policy)
  const s = new MagicString(code)
  const segments: Segment[] = []
  const skipped: Skipped[] = []
  const lines = lineIndex(code)

  const draft = (kind: 'html-block' | 'prop', content: InlineNode[] | string, at: Span, containers: string[], detail?: string): SegmentDraft => ({
    kind,
    format: 'plain',
    content,
    context: { headingTrail: [], containers, ...(detail ? { detail } : {}) },
    position: { startLine: lines(at.start), endLine: lines(at.end), precision: 'node' },
  })

  /** The code that replaces each readable attribute of an element. */
  function attributes(element: ElementNode, containers: string[]): Array<[Attribute, string]> {
    const out: Array<[Attribute, string]> = []
    for (const attribute of element.attributes) {
      if (!ATTRIBUTES.has(attribute.name) || !hasLetters(attribute.value) || PLACEHOLDER_RE.test(attribute.value))
        continue
      const segment = buildSegment(draft('prop', attribute.value, attribute, containers, attribute.name), { file, index: segments.length, policy: resolved })!
      const replacement = emit.attribute(attribute, segment.hash)
      if (replacement === undefined)
        continue
      segments.push(segment)
      out.push([attribute, replacement])
    }
    return out
  }

  /** The opening tag of an element with its readable attributes rewritten. */
  function openTag(element: ElementNode, containers: string[]): string {
    let open = element.open
    for (const [attribute, replacement] of attributes(element, containers).reverse())
      open = open.slice(0, attribute.start - element.start) + replacement + open.slice(attribute.end - element.start)
    return open
  }

  function inline(nodes: MarkupNode[]): InlineNode[] {
    return nodes.flatMap((node): InlineNode[] => {
      switch (node.type) {
        case 'text':
          return [{ type: 'text', value: node.value }]
        case 'expression':
          return [{ type: 'atomic', kind: 'binding', source: code.slice(node.start, node.end), data: node }]
        case 'element':
          return [isOpaque(node)
            ? { type: 'atomic', kind: placeholderType(node), source: code.slice(node.start, node.end), name: node.name, data: node }
            : { type: 'link', open: node.open, close: node.close, children: inline(node.children), data: node }]
        default:
          return []
      }
    })
  }

  function run(nodes: MarkupNode[], containers: string[]) {
    if (!hasWords(nodes)) {
      for (const node of nodes) {
        if (node.type === 'element')
          walk(node, containers)
      }
      return
    }
    const content = nodes.filter(node => !isEmpty(node))
    const only = content[0]!
    if (content.length === 1 && only.type === 'element' && !only.optOut && INLINE.has(only.name))
      return walk(only, containers)

    const start = nodes[0]!.start
    const end = nodes.at(-1)!.end
    const first = content.find(node => node.type !== 'text' || node.value.trim()) ?? only
    const at = { start: first.start, end }
    const inlineNodes = inline(nodes)
    const source = toSkeleton(inlineNodes, 'plain').skeleton
    const ambiguous = findText(nodes, node => PLACEHOLDER_RE.test(node.value))
    if (ambiguous) {
      skipped.push({ line: lines(at.start), reason: 'text reads as a placeholder', text: source.trim() })
      return
    }
    const prepared = prepareSegment(draft('html-block', inlineNodes, at, containers), { file, index: segments.length, policy: resolved })!
    segments.push(prepared.segment)
    const parts = prepared.nodes.map((node, id): Part => {
      const data = node.data as ExpressionNode | ElementNode
      if (data.type === 'expression')
        return { type: 'expression', code: data.code }
      if (prepared.segment.placeholders[id]!.close !== undefined)
        return { type: 'wrapper', open: openTag(data, [...containers, data.name]), close: data.close }
      if (isOpaque(data))
        return { type: 'element', source: code.slice(data.start, data.end) }
      return { type: 'element', source: openTag(data, [...containers, data.name]) + code.slice(data.start + data.open.length, data.end) }
    })
    s.overwrite(start, end, emit.run({ hash: prepared.segment.hash, source, parts, start, end }))
  }

  function walk(element: ElementNode, containers: string[]) {
    if (element.optOut || SKIP.has(element.name))
      return
    for (const [attribute, replacement] of attributes(element, containers))
      s.overwrite(attribute.start, attribute.end, replacement)
    children(element.children, [...containers, element.name])
  }

  function children(nodes: MarkupNode[], containers: string[]) {
    let current: MarkupNode[] = []
    const flush = () => {
      while (current.length && isEmpty(current[0]!))
        current.shift()
      while (current.length && isEmpty(current.at(-1)!))
        current.pop()
      if (current.length)
        run(current, containers)
      current = []
    }
    for (const node of nodes) {
      if (isInlineable(node)) {
        current.push(node)
        continue
      }
      flush()
      if (node.type === 'element')
        walk(node, containers)
      else if (node.type === 'block')
        node.fragments.forEach(fragment => children(fragment, containers))
    }
    flush()
  }

  children(root, [])
  if (segments.length)
    emit.finish?.(s)
  return { code: s.toString(), map: s.generateMap({ source: file, hires: true }), segments, skipped }
}

function findText(nodes: MarkupNode[], test: (node: TextNode) => boolean): TextNode | undefined {
  for (const node of nodes) {
    const found = node.type === 'text' ? (test(node) ? node : undefined) : node.type === 'element' && !isOpaque(node) ? findText(node.children, test) : undefined
    if (found)
      return found
  }
}

/** Returns the 1-based line of an offset. */
function lineIndex(code: string): (offset: number) => number {
  const starts = [0]
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1))
    starts.push(i + 1)
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid]! <= offset)
        low = mid
      else
        high = mid - 1
    }
    return low + 1
  }
}

/** A JavaScript string literal that is also safe inside an HTML attribute, a Vue interpolation and JSX. */
export function literal(value: string): string {
  return `'${value.replace(/[\\'"{}<>\n\r\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}'`
}
