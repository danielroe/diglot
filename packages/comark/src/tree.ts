import type { ElementNode, MarkdownDocument, Node } from 'comark'
import { createMarkdownParser } from 'comark'

/** A parsed comark document, optionally with the markdown it came from. */
export interface ComarkDocument {
  frontmatter: Record<string, unknown>
  nodes: Node[]
  meta?: Record<string, unknown>
  /** The markdown source. When present, protected spans are sliced from it instead of re-rendered. */
  source?: string
  /** 1-based `[start, end]` line range of each top-level node, indexed like `nodes`. */
  lines?: Array<[number, number]>
}

const parserOptions = { autoUnwrap: false, autoClose: false } as const

/** Parses markdown with the options the adapter expects, recording top-level line ranges. */
export async function parse(source: string): Promise<ComarkDocument> {
  const tree = await parseStreaming(source)
  const lines: Array<[number, number]> = []
  let previous = frontmatterEndLine(source)
  for (const node of tree.nodes) {
    const end = isElement(node) ? Number(node[1].$?.line ?? previous + 1) : previous + 1
    lines.push([previous + 1, Math.max(end, previous + 1)])
    previous = Math.max(end, previous + 1)
  }
  return { frontmatter: tree.frontmatter, nodes: stripPositions(tree.nodes), meta: tree.meta, source, lines }
}

/** comark records `$.line` (the end line of top-level blocks) only in streaming mode. */
async function parseStreaming(source: string): Promise<MarkdownDocument> {
  return createMarkdownParser(parserOptions)(source, { streaming: true })
}

export async function parseInline(markdown: string): Promise<Node[] | undefined> {
  const { nodes } = await createMarkdownParser(parserOptions)(markdown)
  const clean = stripPositions(nodes)
  const only = clean.length === 1 && isElement(clean[0]!) ? clean[0] : undefined
  return only?.[0] === 'p' ? children(only) : undefined
}

function frontmatterEndLine(source: string): number {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(source)
  return match ? match[0].split('\n').length - 1 : 0
}

export function isElement(node: Node | undefined): node is ElementNode {
  return Array.isArray(node) && typeof node[0] === 'string'
}

export function children(node: ElementNode): Node[] {
  return node.slice(2) as Node[]
}

export function textOf(nodes: Node[]): string {
  return nodes.map(n => typeof n === 'string' ? n : isElement(n) ? textOf(children(n)) : '').join('')
}

function stripPositions(nodes: Node[]): Node[] {
  return nodes.map(function strip(node): Node {
    if (!Array.isArray(node))
      return node
    const [tag, attrs, ...rest] = node
    const { $, ...props } = attrs ?? {}
    const meta = $ ? Object.fromEntries(Object.entries($).filter(([k]) => k !== 'line')) : undefined
    const next = meta && Object.keys(meta).length ? { ...props, $: meta } : props
    return [tag, next, ...(rest as Node[]).map(strip)] as Node
  })
}
