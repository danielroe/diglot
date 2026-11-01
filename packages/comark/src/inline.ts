import type { InlineNode } from '@diglot/core'
import type { ElementNode, Node } from 'comark'
import type { SourceSlicer } from './slice.ts'
import { BREAK_SOURCE } from '@diglot/core'
import { renderInline, renderLinkParts } from './render.ts'
import { children, isElement, textOf } from './tree.ts'

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
  const out: InlineNode[] = []
  const source = async (sliced: Promise<string | undefined> | undefined, fallback: () => Promise<string>) => {
    const value = await sliced
    if (value !== undefined) {
      if (stats)
        stats.sliced++
      return value
    }
    if (stats)
      stats.rendered++
    return fallback()
  }
  for (const node of nodes) {
    if (typeof node === 'string') {
      out.push(...splitBindings(node))
      continue
    }
    if (!isElement(node))
      continue
    const [tag, attrs] = node
    if (tag in EMPHASIS && !attrs.$?.html) {
      out.push({ type: EMPHASIS[tag as keyof typeof EMPHASIS], children: await toInline(children(node), slicer, stats) })
    }
    else if (tag === 'br') {
      out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE, data: node })
    }
    else if (tag === 'code') {
      out.push({ type: 'atomic', kind: 'code', source: await source(slicer?.code(node), () => renderInline(node)), data: node })
    }
    else if (tag === 'a' && !attrs.$?.html) {
      const inner = await toInline(children(node), slicer, stats)
      const sliced = isAutolink(node) ? undefined : await slicer?.linkClose(node)
      const [open, close] = sliced === undefined ? await renderLinkParts(node) : ['[', sliced]
      if (stats)
        stats[sliced === undefined ? 'rendered' : 'sliced']++
      out.push({ type: 'link', children: inner, open, close, data: node })
    }
    else {
      const rendered = await renderInline(node)
      out.push({
        type: 'atomic',
        kind: tag === 'img' ? 'image' : attrs.$?.html ? 'html' : 'component',
        ...(tag === 'img' ? {} : { name: tag }),
        source: await source(slicer?.span(node, rendered), async () => rendered),
        ...(tag !== 'img' && /\p{L}/u.test(textOf(children(node))) ? { hidesText: true } : {}),
        data: node,
      })
    }
  }
  return out
}

function isAutolink(node: ElementNode): boolean {
  const text = textOf(children(node))
  const href = String(node[1].href ?? '')
  return text === href || `mailto:${text}` === href || `http://${text}` === href
}

function splitBindings(text: string): InlineNode[] {
  const out: InlineNode[] = []
  let last = 0
  for (const match of text.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    if (match.index > last)
      out.push({ type: 'text', value: text.slice(last, match.index) })
    out.push({ type: 'atomic', kind: 'binding', source: match[0], data: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length)
    out.push({ type: 'text', value: text.slice(last) })
  return out
}
