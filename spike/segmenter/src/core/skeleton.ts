import type { InlineNode, Placeholder } from './types.ts'

export interface PlaceholderForm {
  skeleton: string
  placeholders: Placeholder[]
}

const MARKERS = { strong: '**', emphasis: '*', delete: '~~' } as const

/**
 * Collapses whitespace runs (soft line breaks render as spaces), trims the unit and drops
 * whitespace next to hard breaks, so re-wrapping source lines does not change the hash.
 */
export function normalise(nodes: InlineNode[]): InlineNode[] {
  const collapsed = mergeText(nodes.map(collapse))
  const out = collapsed.map((n, i) => {
    if (n.type !== 'text') return n
    let value = n.value
    if (i === 0 || isBreak(collapsed[i - 1])) value = value.trimStart()
    if (i === collapsed.length - 1 || isBreak(collapsed[i + 1])) value = value.trimEnd()
    return { ...n, value }
  })
  return out.filter(n => n.type !== 'text' || n.value !== '')
}

function collapse(node: InlineNode): InlineNode {
  if (node.type === 'text') return { type: 'text', value: node.value.replace(/\s+/g, ' ') }
  if ('children' in node) return { ...node, children: mergeText(node.children.map(collapse)) }
  return node
}

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const n of nodes) {
    const last = out.at(-1)
    if (n.type === 'text' && last?.type === 'text') out[out.length - 1] = { type: 'text', value: last.value + n.value }
    else out.push(n)
  }
  return out
}

function isBreak(n: InlineNode | undefined) {
  return n?.type === 'atomic' && n.kind === 'break'
}

/**
 * Builds the placeholder form: protected spans become `{n}`, links with translatable
 * text become `{n}text{/n}`, emphasis keeps its markdown markers.
 */
export function toPlaceholderForm(nodes: InlineNode[]): PlaceholderForm {
  const placeholders: Placeholder[] = []
  const visit = (node: InlineNode): string => {
    switch (node.type) {
      case 'text':
        return escapeText(node.value)
      case 'strong':
      case 'emphasis':
      case 'delete':
        return MARKERS[node.type] + node.children.map(visit).join('') + MARKERS[node.type]
      case 'link': {
        const id = placeholders.length
        if (!hasLetters(node.children) || isUrlLike(plainText(node.children))) {
          placeholders.push({ id, type: 'link', source: node.open + toMarkdown(node.children) + node.close })
          return `{${id}}`
        }
        placeholders.push({ id, type: 'link', source: node.open, close: node.close })
        return `{${id}}${node.children.map(visit).join('')}{/${id}}`
      }
      case 'atomic': {
        const id = placeholders.length
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
  return { skeleton: escapeLineStart(nodes.map(visit).join('')), placeholders }
}

/** Canonical markdown for inline content (placeholders resolved). */
export function toMarkdown(nodes: InlineNode[]): string {
  const { skeleton, placeholders } = toPlaceholderForm(nodes)
  return fromPlaceholderForm(skeleton, placeholders)
}

/** Re-injects protected spans into a (possibly translated) skeleton. */
export function fromPlaceholderForm(skeleton: string, placeholders: Placeholder[]): string {
  return skeleton.replace(/(?<!\\)\{(\/?)(\d+)\}/g, (match, closing: string, id: string) => {
    const ph = placeholders[Number(id)]
    if (!ph) return match
    return closing ? (ph.close ?? '') : ph.source
  })
}

/**
 * Backslash-escapes characters that markdown, GFM tables or MDC syntax would otherwise
 * interpret. CommonMark allows escaping any ASCII punctuation, so over-escaping is safe.
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
  return /^\s*(?:[a-z][\w+.-]*:\/\/|www\.|mailto:)\S*\s*$/i.test(text) || /^\s*\S+@\S+\.\w+\s*$/.test(text)
}

function hasLetters(nodes: InlineNode[]): boolean {
  return nodes.some(n => n.type === 'text' ? /\p{L}/u.test(n.value) : 'children' in n && hasLetters(n.children))
}

/** True when the skeleton has no letters outside placeholders. */
export function isPlaceholderOnly(skeleton: string): boolean {
  return !/\p{L}/u.test(stripPlaceholders(skeleton))
}

export function stripPlaceholders(skeleton: string): string {
  return skeleton.replace(/\{\/?\d+\}/g, ' ')
}

export function countWords(skeleton: string): number {
  return (stripPlaceholders(skeleton).match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length
}

/** Plain text of inline content, used for heading trails. */
export function plainText(nodes: InlineNode[]): string {
  return nodes.map(n => n.type === 'text' ? n.value : 'children' in n ? plainText(n.children) : '').join('')
}
