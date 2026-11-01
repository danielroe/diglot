import type { ElementNode, MarkdownDocument, Node } from 'comark'
import { createMarkdownParser } from 'comark'
import { renderMarkdown } from 'comark/render'
import { buildSegment } from '../core/segment.ts'
import { fromPlaceholderForm } from '../core/skeleton.ts'
import { validate } from '../core/validate.ts'
import { frontmatterProse, setPath } from '../core/frontmatter.ts'
import { BREAK_SOURCE, HTML_TEXT_CONTAINERS, isProseCodeLabel, isProseComment, kindForContainers, PROSE_PROPS } from '../core/policy.ts'
import type { InlineNode, Segment, SegmentDraft, SegmentKind, SegmentPosition } from '../core/types.ts'

export interface ComarkDocument {
  frontmatter: Record<string, unknown>
  nodes: Node[]
  /** 1-based [start, end] line range of each top-level node, indexed like `nodes`. */
  lines: Array<[number, number]>
}

export interface CodeBlockInfo {
  language: string
  lines: number
  commentLines: number
}

export interface Extracted {
  segments: Segment[]
  codeBlocks: CodeBlockInfo[]
}

export const parserOptions = { autoUnwrap: false, autoClose: false } as const

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const LISTS = new Set(['ul', 'ol'])
const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr'])
const INLINE_TAGS = new Set(['a', 'strong', 'em', 'code', 'del', 's', 'span', 'br', 'img', 'kbd', 'sup', 'sub', 'mark', 'u', 'i', 'b', 'small', 'abbr', 'badge', 'math'])
const UNTRANSLATABLE = new Set(['pre', 'hr', 'video', 'source', 'iframe', 'script', 'style'])

// comark renders `br` as a trailing-space hard break, which cannot express two
// consecutive breaks and merges with a following newline into a paragraph break.
const renderOptions = { components: { br: () => BREAK_SOURCE } }
const SENTINEL = '\uE000'

export async function parse(source: string): Promise<ComarkDocument> {
  // comark only records `$.line` (end line of top-level blocks) in streaming mode, and
  // a parser instance reuses its previous output across streaming calls.
  const parser = createMarkdownParser(parserOptions)
  const tree = await parser(source, { streaming: true }) as MarkdownDocument
  const lines: Array<[number, number]> = []
  let prevEnd = frontmatterEndLine(source)
  for (const node of tree.nodes) {
    const end = isElement(node) ? (node[1].$?.line ?? prevEnd + 1) : prevEnd + 1
    lines.push([prevEnd + 1, end])
    prevEnd = end
  }
  return { frontmatter: tree.frontmatter, nodes: stripPositions(tree.nodes), lines }
}

export async function render(doc: Pick<ComarkDocument, 'frontmatter' | 'nodes'>): Promise<string> {
  return renderMarkdown({ frontmatter: doc.frontmatter, nodes: doc.nodes, meta: {} }, renderOptions)
}

/** Parses an inline markdown fragment; `undefined` unless it is exactly one paragraph. */
export async function parseInline(markdown: string): Promise<Node[] | undefined> {
  const { nodes } = await createMarkdownParser(parserOptions)(markdown)
  const clean = stripPositions(nodes)
  const only = clean.length === 1 && isElement(clean[0]!) ? clean[0] : undefined
  return only?.[0] === 'p' ? children(only) : undefined
}

type Target =
  | { type: 'range', parent: Node[], start: number, end: number }
  | { type: 'attr', attrs: Record<string, unknown>, key: string }
  | { type: 'frontmatter', path: Array<string | number> }

interface Unit {
  kind: SegmentKind
  content: Node[] | string
  context: SegmentDraft['context']
  position: SegmentPosition
  target: Target
}

export async function extract(file: string, doc: ComarkDocument): Promise<Extracted> {
  const { units, codeBlocks } = walk(doc)
  const segments: Segment[] = []
  for (const unit of units) {
    const seg = buildSegment(file, segments.length, await toDraft(unit))
    if (seg) segments.push(seg)
  }
  return { segments, codeBlocks }
}

/**
 * Returns a copy of `doc` with every segment whose hash is in `translations` replaced.
 * Translations are skeletons; protected spans are re-injected from the current source.
 * Heading ids stay as parsed from the source, so the renderer writes them out explicitly
 * (`{#id}`) once the translated text no longer slugifies to the same id.
 */
export async function apply(doc: ComarkDocument, translations: Map<string, string>): Promise<ApplyResult> {
  const copy: ComarkDocument = structuredClone(doc)
  const { units } = walk(copy)
  const ranges: Array<{ target: Extract<Target, { type: 'range' }>, nodes: Node[] }> = []
  const result: ApplyResult = { doc: copy, applied: 0, missing: 0, rejected: [] }
  let index = 0
  for (const unit of units) {
    const seg = buildSegment('', index, await toDraft(unit))
    if (!seg) continue
    index++
    const translated = translations.get(seg.hash)
    if (translated === undefined) {
      result.missing++
      continue
    }
    const check = validate(translated, seg)
    if (!check.ok) {
      result.rejected.push({ hash: seg.hash, errors: check.errors })
      continue
    }
    const { target } = unit
    if (target.type === 'attr') {
      target.attrs[target.key] = translated
    } else if (target.type === 'frontmatter') {
      setPath(copy.frontmatter, target.path, translated)
    } else {
      const nodes = await parseInline(fromPlaceholderForm(translated, seg.placeholders))
      if (!nodes) {
        result.rejected.push({ hash: seg.hash, errors: ['did not parse to a single paragraph'] })
        continue
      }
      ranges.push({ target, nodes })
    }
    result.applied++
  }
  for (const { target, nodes } of ranges.reverse()) {
    target.parent.splice(target.start, target.end - target.start, ...nodes)
  }
  return result
}

export interface ApplyResult {
  doc: ComarkDocument
  applied: number
  /** Segments without a translation; they keep the source text. */
  missing: number
  /** Translations that failed validation; those segments keep the source text. */
  rejected: Array<{ hash: string, errors: string[] }>
}

function walk(doc: ComarkDocument): { units: Unit[], codeBlocks: CodeBlockInfo[] } {
  const units: Unit[] = []
  const codeBlocks: CodeBlockInfo[] = []
  let trail: string[] = []
  let line: [number, number] = [1, 1]
  const blockPos = (): SegmentPosition => ({ startLine: line[0], endLine: line[1], precision: 'block' })
  const ctx = (containers: string[], detail?: string) => ({ headingTrail: trail.filter(Boolean), containers, ...(detail ? { detail } : {}) })

  for (const [path, value] of frontmatterProse(doc.frontmatter)) {
    units.push({ kind: 'frontmatter', content: value, context: ctx([], path.join('.')), position: { startLine: 1, endLine: 1, precision: 'file' }, target: { type: 'frontmatter', path } })
  }

  const pushInline = (kind: SegmentKind, parent: Node[], start: number, end: number, containers: string[], detail?: string) => {
    const nodes = parent.slice(start, end)
    if (!nodes.some(n => typeof n !== 'string' || n.trim())) return
    for (const img of findImages(nodes)) {
      if (typeof img[1].alt === 'string' && img[1].alt.trim()) {
        units.push({ kind: 'image-alt', content: img[1].alt, context: ctx(containers, 'alt'), position: blockPos(), target: { type: 'attr', attrs: img[1], key: 'alt' } })
      }
    }
    units.push({ kind, content: nodes, context: ctx(containers, detail), position: blockPos(), target: { type: 'range', parent, start, end } })
  }

  const pushProps = (node: ElementNode, containers: string[]) => {
    for (const prop of PROSE_PROPS[node[0]] ?? []) {
      const value = node[1][prop]
      if (typeof value === 'string' && value.trim()) {
        units.push({ kind: 'prop', content: value, context: ctx(containers, prop), position: blockPos(), target: { type: 'attr', attrs: node[1], key: prop } })
      }
    }
  }

  const visitMixed = (parent: Node[], start: number, containers: string[], kind?: SegmentKind) => {
    let runStart = -1
    const flush = (end: number) => {
      if (runStart >= 0) pushInline(kind ?? kindForContainers(containers), parent, runStart, end, containers)
      runStart = -1
    }
    for (let i = start; i < parent.length; i++) {
      if (isInline(parent[i]!)) {
        if (runStart < 0) runStart = i
      } else {
        flush(i)
        visitBlock(parent[i]!, containers)
      }
    }
    flush(parent.length)
  }

  const visitBlock = (node: Node, containers: string[]) => {
    if (!isElement(node)) return
    const [tag, attrs] = node
    if (UNTRANSLATABLE.has(tag)) {
      if (tag === 'pre') {
        codeBlocks.push(codeInfo(node))
        const label = attrs.filename
        if (typeof label === 'string' && isProseCodeLabel(label)) {
          units.push({ kind: 'code-label', content: label, context: ctx(containers, 'filename'), position: blockPos(), target: { type: 'attr', attrs, key: 'filename' } })
        }
      }
      return
    }
    if (HEADINGS.has(tag)) {
      const level = Number(tag[1])
      pushInline('heading', node, 2, node.length, containers, tag)
      trail = Array.from({ length: level }, (_, i) => i < level - 1 ? (trail[i] ?? '') : textOf(children(node)))
      return
    }
    if (tag === 'p') return pushInline(kindForContainers(containers), node, 2, node.length, containers)
    if (tag === 'th' || tag === 'td') return pushInline('table-cell', node, 2, node.length, containers, tag)
    if (TABLE_PARTS.has(tag) || LISTS.has(tag)) {
      const inner = tag === 'table' ? [...containers, 'table'] : containers
      for (const c of children(node)) visitBlock(c, inner)
      return
    }
    const name = tag === 'template' ? `${containers.at(-1) ?? ''}#${attrs.name ?? 'default'}` : tag
    const inner = tag === 'template' ? [...containers.slice(0, -1), name] : [...containers, name]
    if (tag !== 'template' && tag !== 'li' && tag !== 'blockquote') pushProps(node, inner)
    visitMixed(node, 2, inner, HTML_TEXT_CONTAINERS.has(tag) ? 'html-block' : undefined)
  }

  doc.nodes.forEach((node, i) => {
    line = doc.lines[i] ?? line
    if (isInline(node)) pushInline('paragraph', doc.nodes, i, i + 1, [])
    else visitBlock(node, [])
  })
  return { units, codeBlocks }
}

async function toDraft(unit: Unit): Promise<SegmentDraft> {
  return {
    kind: unit.kind,
    content: typeof unit.content === 'string' ? unit.content : await toInline(unit.content),
    context: unit.context,
    position: unit.position,
  }
}

/** Converts comark inline nodes to the core's parser-neutral representation. */
export async function toInline(nodes: Node[]): Promise<InlineNode[]> {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (typeof node === 'string') {
      out.push(...splitBindings(node))
      continue
    }
    if (!isElement(node)) continue
    const [tag, attrs] = node
    switch (tag) {
      case 'strong':
      case 'em':
      case 'del':
        out.push({ type: tag === 'em' ? 'emphasis' : tag === 'del' ? 'delete' : 'strong', children: await toInline(children(node)) })
        break
      case 'code':
        out.push({ type: 'atomic', kind: 'code', source: await renderInline(node) })
        break
      case 'br':
        out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE })
        break
      case 'img':
        out.push({ type: 'atomic', kind: 'image', source: await renderInline(node) })
        break
      case 'a': {
        const [open, close] = (await renderInline([tag, attrs, SENTINEL])).split(SENTINEL)
        out.push({ type: 'link', children: await toInline(children(node)), open: open!, close: close! })
        break
      }
      default:
        out.push({
          type: 'atomic',
          kind: attrs.$?.html ? 'html' : 'component',
          name: tag,
          source: await renderInline(node),
          ...(/\p{L}/u.test(textOf(children(node))) ? { hidesText: true } : {}),
        })
    }
  }
  return out
}

function splitBindings(text: string): InlineNode[] {
  const out: InlineNode[] = []
  let last = 0
  for (const m of text.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    out.push({ type: 'atomic', kind: 'binding', source: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

async function renderInline(node: ElementNode): Promise<string> {
  // A leading text node keeps comark from rendering a lone component in block form.
  const md = await renderMarkdown({ nodes: [['p', {}, SENTINEL, node]] }, renderOptions)
  return md.trim().slice(SENTINEL.length)
}

function isInline(node: Node): boolean {
  if (typeof node === 'string') return true
  if (!isElement(node) || HTML_TEXT_CONTAINERS.has(node[0])) return false
  return INLINE_TAGS.has(node[0]) || node[1].$?.block === 0
}

function findImages(nodes: Node[]): ElementNode[] {
  const found: ElementNode[] = []
  const visit = (n: Node) => {
    if (!isElement(n)) return
    if (n[0] === 'img') found.push(n)
    children(n).forEach(visit)
  }
  nodes.forEach(visit)
  return found
}

function codeInfo(node: ElementNode): CodeBlockInfo {
  const code = children(node).find(isElement)
  const body = code ? children(code).filter(c => typeof c === 'string').join('') : ''
  const language = String(node[1].language ?? '')
  const lines = body.split('\n')
  return { language, lines: lines.length, commentLines: lines.filter(l => isProseComment(l, language)).length }
}



function frontmatterEndLine(source: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(source)
  return m ? m[0].split('\n').length - 1 : 0
}

function textOf(nodes: Node[]): string {
  return nodes.map(n => typeof n === 'string' ? n : isElement(n) ? textOf(children(n)) : '').join('')
}

export function isElement(node: Node): node is ElementNode {
  return Array.isArray(node) && typeof node[0] === 'string'
}

export function children(node: ElementNode): Node[] {
  return node.slice(2) as Node[]
}

export function stripPositions(nodes: Node[]): Node[] {
  return nodes.map(function strip(node): Node {
    if (!Array.isArray(node)) return node
    const [tag, attrs, ...rest] = node
    const { $, ...props } = attrs ?? {}
    const meta = $ ? Object.fromEntries(Object.entries($).filter(([k]) => k !== 'line')) : undefined
    const nextAttrs = meta && Object.keys(meta).length ? { ...props, $: meta } : props
    return [tag, nextAttrs, ...(rest as Node[]).map(strip)] as Node
  })
}
