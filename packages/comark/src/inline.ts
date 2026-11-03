import type { AtomicNode, InlineNode, LinkNode } from '@diglot/core'
import type { ElementNode, Node } from 'comark'
import type { SourceSlicer } from './slice.ts'
import { BREAK_SOURCE } from '@diglot/core'
import { renderInline, renderLinkParts } from './render.ts'
import { children, elementText, isElement } from './tree.ts'

const EMPHASIS = { strong: 'strong', em: 'emphasis', del: 'delete' } as const

export interface InlineStats {
  sliced: number
  rendered: number
}

/**
 * Converts comark inline nodes to the core representation. Every link and atomic node
 * carries its comark node in `data`; text-embedded bindings carry their string.
 */
export async function toInline(nodes: Node[], slicer?: SourceSlicer, stats?: InlineStats): Promise<InlineNode[]> {
  const spans: Array<LinkNode | AtomicNode> = []
  const out = inlineNodes(nodes, spans)
  await resolveSources(spans, slicer, stats)
  return out
}

/**
 * `toInline` without span sources: links, inline code, images, components and inline HTML get
 * empty markdown. With `spans`, each of them is collected there, in source order.
 */
export function inlineNodes(nodes: Node[], spans?: Array<LinkNode | AtomicNode>): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (typeof node === 'string') {
      splitBindings(node, out)
      continue
    }
    if (!isElement(node))
      continue
    const tag = node[0]
    const attrs = node[1]
    if (tag in EMPHASIS && !attrs.$?.html) {
      out.push({ type: EMPHASIS[tag as keyof typeof EMPHASIS], children: inlineNodes(children(node), spans) })
      continue
    }
    if (tag === 'br') {
      out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE, data: node })
      continue
    }
    let span: LinkNode | AtomicNode
    if (tag === 'code') {
      span = { type: 'atomic', kind: 'code', source: '', data: node }
    }
    else if (tag === 'a' && !attrs.$?.html) {
      span = { type: 'link', children: inlineNodes(children(node), spans), open: '', close: '', data: node }
    }
    else {
      span = {
        type: 'atomic',
        kind: tag === 'img' ? 'image' : attrs.$?.html ? 'html' : 'component',
        ...(tag === 'img' ? {} : { name: tag }),
        source: '',
        ...(tag !== 'img' && /\p{L}/u.test(elementText(node)) ? { hidesText: true } : {}),
        data: node,
      }
    }
    out.push(span)
    spans?.push(span)
  }
  return out
}

async function resolveSources(spans: Array<LinkNode | AtomicNode>, slicer?: SourceSlicer, stats?: InlineStats): Promise<void> {
  const source = async (slice: (() => Promise<string | undefined>) | undefined, fallback: () => Promise<string>) => {
    const value = await slice?.()
    if (value !== undefined) {
      if (stats)
        stats.sliced++
      return value
    }
    if (stats)
      stats.rendered++
    return fallback()
  }
  for (const span of spans) {
    const node = span.data as ElementNode
    if (span.type === 'link') {
      const sliced = isAutolink(node) ? undefined : await slicer?.linkClose(node)
      const [open, close] = sliced === undefined ? await renderLinkParts(node) : ['[', sliced]
      if (stats)
        stats[sliced === undefined ? 'rendered' : 'sliced']++
      span.open = open
      span.close = close
    }
    else if (span.kind === 'code') {
      span.source = await source(slicer && (() => slicer.code(node)), () => renderInline(node))
    }
    else {
      let rendered: Promise<string> | undefined
      const render = () => rendered ??= renderInline(node)
      span.source = await source(slicer && (async () => slicer.span(node, await render())), render)
    }
  }
}

function isAutolink(node: ElementNode): boolean {
  const text = elementText(node)
  const href = String(node[1].href ?? '')
  return text === href || `mailto:${text}` === href || `http://${text}` === href
}

function splitBindings(text: string, out: InlineNode[]): void {
  if (!text.includes('{{')) {
    if (text)
      out.push({ type: 'text', value: text })
    return
  }
  let last = 0
  for (const match of text.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    if (match.index > last)
      out.push({ type: 'text', value: text.slice(last, match.index) })
    out.push({ type: 'atomic', kind: 'binding', source: match[0], data: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length)
    out.push({ type: 'text', value: text.slice(last) })
}
