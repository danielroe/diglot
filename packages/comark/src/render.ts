import type { ElementNode, Node } from 'comark'
import type { ComarkDocument } from './tree.ts'
import { BREAK_SOURCE } from '@diglot/core'
import { renderMarkdown } from 'comark/render'
import { isElement } from './tree.ts'

/** comark renders `br` as a trailing-space break, which cannot express two breaks in a row and merges with a following newline. */
const renderOptions = { components: { br: () => BREAK_SOURCE } }

const SENTINEL = '\uE000'
const BINDING_PREFIX = 'data-diglot-bind-'

/**
 * Renders a document to comark markdown. Hard breaks render as `:br`, and bound HTML
 * attributes (`:zoom="false"`) keep their colon.
 */
export async function render(doc: Pick<ComarkDocument, 'frontmatter' | 'nodes'>): Promise<string> {
  const markdown = await renderMarkdown({ frontmatter: doc.frontmatter, nodes: protectBindings(doc.nodes), meta: {} }, renderOptions)
  return restoreBindings(markdown)
}

/** Renders one inline node as markdown. */
export async function renderInline(node: ElementNode): Promise<string> {
  const markdown = await renderMarkdown({ nodes: [['p', {}, SENTINEL, ...protectBindings([node])]] }, renderOptions)
  return restoreBindings(markdown.trim().slice(SENTINEL.length))
}

/** Renders a link with placeholder text and returns the markdown before and after the text. */
export async function renderLinkParts(node: ElementNode): Promise<[string, string]> {
  const markdown = await renderInline([node[0], node[1], SENTINEL])
  const [open = '', close = ''] = markdown.split(SENTINEL)
  return [open, close]
}

/** comark drops the colon of bound attributes on HTML elements; an alias attribute survives rendering. */
function protectBindings(nodes: Node[]): Node[] {
  return nodes.map(function visit(node): Node {
    if (!isElement(node))
      return node
    const [tag, attrs, ...rest] = node
    const html = attrs.$?.html === 1
    const next = html && Object.keys(attrs).some(k => k.startsWith(':'))
      ? Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.startsWith(':') ? BINDING_PREFIX + k.slice(1) : k, v]))
      : attrs
    return [tag, next, ...(rest as Node[]).map(visit)] as ElementNode
  })
}

function restoreBindings(markdown: string): string {
  return markdown.replaceAll(BINDING_PREFIX, ':')
}
