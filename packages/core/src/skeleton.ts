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
    return { type: 'text', value: node.value.replace(/\s+/g, ' ') }
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
        return markdown ? escapeText(node.value) : node.value
      case 'strong':
      case 'emphasis':
      case 'delete': {
        const inner = node.children.map(visit).join('')
        return markdown ? MARKERS[node.type] + inner + MARKERS[node.type] : inner
      }
      case 'link': {
        const id = placeholders.length
        byId.push(node)
        if (!markdown || !hasLetters(node.children) || isUrlLike(plainText(node.children))) {
          placeholders.push({ id, type: 'link', source: node.open + toMarkdown(node.children) + node.close })
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
  return skeleton.replace(/(?<!\\)\{(\/?)(\d+)\}/g, (match, closing: string, id: string) => {
    const placeholder = placeholders[Number(id)]
    if (!placeholder)
      return match
    return closing ? (placeholder.close ?? '') : placeholder.source
  })
}

/**
 * Parses a skeleton that has passed `validate` into text, emphasis and placeholder nodes.
 * Escapes are resolved, so text values are literal.
 */
export function parseSkeleton(skeleton: string, placeholders: Placeholder[], format: SegmentFormat = 'markdown'): SkeletonNode[] {
  const paired = new Set(placeholders.filter(p => p.close !== undefined).map(p => p.id))
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
    if (token.type === 'char') {
      push({ type: 'text', value: token.value })
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
  return value
    .replace(/[\\`*_[\]<{}~|]/g, '\\$&')
    .replace(/(^|\s):(?=[a-z])/gi, '$1\\:')
    .replace(/&(?=#?\w+;)/g, '\\&')
}

function escapeLineStart(skeleton: string): string {
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

function stripPlaceholders(skeleton: string): string {
  return skeleton.replace(/\{\/?\d+\}/g, ' ')
}

/** True when the skeleton has no letters outside placeholders, so there is nothing to translate. */
export function isPlaceholderOnly(skeleton: string): boolean {
  return !/\p{L}/u.test(stripPlaceholders(skeleton))
}

/** Number of words outside placeholders. */
export function countWords(skeleton: string): number {
  return (stripPlaceholders(skeleton).match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length
}

/** Plain text of inline content, ignoring protected spans. */
export function plainText(nodes: InlineNode[]): string {
  return nodes.map(node => node.type === 'text' ? node.value : node.type === 'atomic' ? '' : plainText(node.children)).join('')
}
