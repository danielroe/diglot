import type { AtomicNode, InlineNode, LinkNode, Placeholder, SegmentFormat } from './types.ts'
import { tokenize } from './grammar.ts'

export interface SkeletonResult {
  skeleton: string
  placeholders: Placeholder[]
  /** The inline node behind each placeholder, indexed by placeholder id. */
  nodes: Array<LinkNode | AtomicNode>
}

/** A parsed (translated) skeleton. */
export type SkeletonNode
  = | { type: 'text', value: string }
    | { type: 'strong' | 'emphasis' | 'delete', children: SkeletonNode[] }
    | { type: 'placeholder', id: number, children?: SkeletonNode[] }

const MARKERS = { strong: '**', emphasis: '*', delete: '~~' } as const

/**
 * Collapses whitespace runs, trims the unit and drops whitespace next to hard breaks, so
 * re-wrapping source lines does not change the skeleton.
 */
export function normalise(nodes: InlineNode[]): InlineNode[] {
  const collapsed = mergeText(nodes.map(collapse))
  const out = collapsed.map((node, i) => {
    if (node.type !== 'text')
      return node
    let value = node.value
    if (i === 0 || isBreak(collapsed[i - 1]))
      value = value.trimStart()
    if (i === collapsed.length - 1 || isBreak(collapsed[i + 1]))
      value = value.trimEnd()
    return { ...node, value }
  })
  return out.filter(node => node.type !== 'text' || node.value !== '')
}

function collapse(node: InlineNode): InlineNode {
  if (node.type === 'text')
    return /[^\S \u00A0]| {2}/.test(node.value) ? { type: 'text', value: node.value.replace(/[^\S\u00A0]+/g, ' ') } : node
  if (node.type === 'atomic')
    return node
  return { ...node, children: mergeText(node.children.map(collapse)) }
}

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (node.type === 'text' && last?.type === 'text')
      out[out.length - 1] = { type: 'text', value: last.value + node.value }
    else
      out.push(node)
  }
  return out
}

function isBreak(node: InlineNode | undefined): boolean {
  return node?.type === 'atomic' && node.kind === 'break'
}

/**
 * Builds the placeholder form of normalised inline content: protected spans become `{n}`,
 * links with translatable text become `{n}text{/n}` and emphasis keeps its markers. In
 * `plain` format text is not escaped and emphasis is flattened.
 */
export function toSkeleton(nodes: InlineNode[], format: SegmentFormat = 'markdown'): SkeletonResult {
  const placeholders: Placeholder[] = []
  const byId: Array<LinkNode | AtomicNode> = []
  const markdown = format === 'markdown'
  const visit = (node: InlineNode): string => {
    switch (node.type) {
      case 'text':
        return markdown ? encodeInvisibles(escapeText(node.value)) : node.value
      case 'strong':
      case 'emphasis':
      case 'delete': {
        const inner = node.children.map(visit).join('')
        return markdown ? MARKERS[node.type] + inner + MARKERS[node.type] : inner
      }
      case 'link': {
        const id = placeholders.length
        byId.push(node)
        if (!hasLetters(node.children) || isUrlLike(plainText(node.children))) {
          const inner = toSkeleton(node.children, format)
          placeholders.push({ id, type: 'link', source: node.open + fromSkeleton(inner.skeleton, inner.placeholders) + node.close })
          return `{${id}}`
        }
        placeholders.push({ id, type: 'link', source: node.open, close: node.close })
        return `{${id}}${node.children.map(visit).join('')}{/${id}}`
      }
      case 'atomic': {
        const id = placeholders.length
        byId.push(node)
        placeholders.push({
          id,
          type: node.kind,
          source: node.source,
          ...(node.name ? { name: node.name } : {}),
          ...(node.hidesText ? { hidesText: true } : {}),
        })
        return `{${id}}`
      }
    }
  }
  const body = nodes.map(visit).join('')
  return { skeleton: markdown ? escapeLineStart(body) : body, placeholders, nodes: byId }
}

/** Canonical markdown of inline content, with protected spans resolved. */
export function toMarkdown(nodes: InlineNode[]): string {
  const { skeleton, placeholders } = toSkeleton(nodes)
  return fromSkeleton(skeleton, placeholders)
}

/** Re-injects protected spans into a (possibly translated) skeleton. */
export function fromSkeleton(skeleton: string, placeholders: Placeholder[]): string {
  if (!placeholders.length)
    return skeleton
  let out = ''
  let last = 0
  for (let open = skeleton.indexOf('{'); open >= 0; open = skeleton.indexOf('{', open + 1)) {
    if (open > 0 && skeleton.charCodeAt(open - 1) === 0x5C)
      continue
    let end = open + 1
    const closing = skeleton.charCodeAt(end) === 0x2F
    if (closing)
      end++
    const digits = end
    while (end < skeleton.length && skeleton.charCodeAt(end) >= 0x30 && skeleton.charCodeAt(end) <= 0x39)
      end++
    if (end === digits || skeleton.charCodeAt(end) !== 0x7D)
      continue
    const placeholder = placeholders[Number(skeleton.slice(digits, end))]
    if (!placeholder)
      continue
    out += skeleton.slice(last, open) + (closing ? (placeholder.close ?? '') : placeholder.source)
    last = end + 1
    open = end
  }
  return last ? out + skeleton.slice(last) : skeleton
}

/**
 * Parses a skeleton that has passed `validate` into text, emphasis and placeholder nodes.
 * Escapes are resolved, so text values are literal.
 */
export function parseSkeleton(skeleton: string, placeholders: Placeholder[], format: SegmentFormat = 'markdown'): SkeletonNode[] {
  const paired = new Set<number>()
  for (const placeholder of placeholders) {
    if (placeholder.close !== undefined)
      paired.add(placeholder.id)
  }
  const root: SkeletonNode[] = []
  const stack: Array<{ key: string, children: SkeletonNode[] }> = [{ key: '', children: root }]
  const push = (node: SkeletonNode) => {
    const children = stack.at(-1)!.children
    const last = children.at(-1)
    if (node.type === 'text' && last?.type === 'text')
      last.value += node.value
    else
      children.push(node)
  }
  for (const token of tokenize(skeleton, { markers: format === 'markdown' })) {
    if (token.type === 'text' || token.type === 'char') {
      push({ type: 'text', value: format === 'markdown' && token.type === 'text' ? decodeInvisibles(token.value) : token.value })
    }
    else if (token.type === 'marker') {
      if (stack.at(-1)!.key === token.value) {
        stack.pop()
        continue
      }
      const type = token.value === '~~' ? 'delete' : token.value.length === 2 ? 'strong' : 'emphasis'
      const node: SkeletonNode = { type, children: [] }
      push(node)
      stack.push({ key: token.value, children: node.children })
    }
    else if (token.type === 'open') {
      if (!paired.has(token.id)) {
        push({ type: 'placeholder', id: token.id })
        continue
      }
      const node = { type: 'placeholder' as const, id: token.id, children: [] as SkeletonNode[] }
      push(node)
      stack.push({ key: `{${token.id}}`, children: node.children })
    }
    else if (stack.at(-1)!.key === `{${token.id}}`) {
      stack.pop()
    }
  }
  return root
}

/**
 * Backslash-escapes characters that markdown, GFM tables or MDC would otherwise interpret.
 * CommonMark allows escaping any ASCII punctuation, so over-escaping is safe.
 */
export function escapeText(value: string): string {
  if (!/[\\`*_[\]<{}~|:&]/.test(value))
    return value
  return value
    .replace(/[\\`*_[\]<{}~|]/g, '\\$&')
    .replace(/(^|\s):(?=[a-z])/gi, '$1\\:')
    .replace(/&(?=#?\w+;)/g, '\\&')
}

/** Writes soft hyphens and no-break spaces as `&shy;` and `&nbsp;`, the spellings markdown segments require. */
export function encodeInvisibles(value: string): string {
  return value.replace(/\u00AD/g, '&shy;').replace(/\u00A0/g, '&nbsp;')
}

function withoutInvisibles(skeleton: string): string {
  return skeleton.replace(/\u00AD|(?<!\\)&(shy|nbsp);/g, (_, name) => name === 'nbsp' ? ' ' : '')
}

function decodeInvisibles(value: string): string {
  return value.replace(/&shy;/g, '\u00AD').replace(/&nbsp;/g, '\u00A0')
}

function escapeLineStart(skeleton: string): string {
  if (!/^[#>+=\-\d]/.test(skeleton))
    return skeleton
  return skeleton
    .replace(/^(#{1,6}|[>+=-])(?=\s|$)/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
}

function isUrlLike(text: string): boolean {
  return /^\s*(?:[a-z][\w+.-]*:\/\/|www\.|mailto:)\S*\s*$/i.test(text) || /^\s*\S[^\s@]*@\S+\.\w+\s*$/.test(text)
}

function hasLetters(nodes: InlineNode[]): boolean {
  return nodes.some(node => node.type === 'text' ? /\p{L}/u.test(node.value) : node.type !== 'atomic' && hasLetters(node.children))
}

// Placeholders hold no letters and their braces end a word, so neither function strips them.
const LETTER_RE = /\p{L}/u
const NUMBER_RE = /\p{N}/u

/** True when the skeleton has no letters outside placeholders, so there is nothing to translate. */
export function isPlaceholderOnly(skeleton: string): boolean {
  return !LETTER_RE.test(withoutInvisibles(skeleton))
}

/** Number of words outside placeholders: runs of letters, numbers, apostrophes and hyphens that start with a letter. */
export function countWords(skeleton: string): number {
  skeleton = withoutInvisibles(skeleton)
  let count = 0
  let inWord = false
  for (let i = 0; i < skeleton.length; i++) {
    const code = skeleton.charCodeAt(i)
    let letter: boolean
    let part: boolean
    if (code < 0x80) {
      letter = (code | 0x20) >= 0x61 && (code | 0x20) <= 0x7A
      part = letter || (code >= 0x30 && code <= 0x39) || code === 0x27 || code === 0x2D
    }
    else if (code === 0x2019) {
      letter = false
      part = true
    }
    else {
      const point = skeleton.codePointAt(i)!
      if (point > 0xFFFF)
        i++
      const char = String.fromCodePoint(point)
      letter = LETTER_RE.test(char)
      part = letter || NUMBER_RE.test(char)
    }
    if (inWord) {
      inWord = part
    }
    else if (letter) {
      inWord = true
      count++
    }
  }
  return count
}

/** Plain text of inline content, ignoring protected spans. */
export function plainText(nodes: InlineNode[]): string {
  let text = ''
  for (const node of nodes) {
    if (node.type === 'text')
      text += node.value
    else if (node.type !== 'atomic')
      text += plainText(node.children)
  }
  return text
}
