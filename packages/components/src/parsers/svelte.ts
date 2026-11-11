import type { Attribute, ElementNode, Emitter, MarkupNode, Parsed, Part, Run, Span } from '../markup.ts'
import { literal } from '../markup.ts'

/** The modern Svelte AST, read loosely: only the node types extraction needs. */
type Node = Record<string, any> & Span & { type: string }

const ELEMENTS = new Set(['RegularElement', 'Component', 'TitleElement', 'SlotElement', 'SvelteElement', 'SvelteComponent', 'SvelteSelf', 'SvelteFragment', 'SvelteBoundary'])

/** Nodes the compiler lifts out of their fragment before it trims whitespace. */
const HOISTED = new Set(['ConstTag', 'DeclarationTag', 'DebugTag', 'SvelteBody', 'SvelteWindow', 'SvelteDocument', 'SvelteHead', 'TitleElement', 'SnippetBlock'])

/** Parents whose whitespace-only text the compiler drops. */
const NO_SPACE = new Set(['select', 'tr', 'table', 'tbody', 'thead', 'tfoot', 'colgroup', 'datalist'])

const START_RE = /^[ \t\r\n]+/
const END_RE = /[ \t\r\n]+$/
const isBlank = (value: string) => !/[^ \t\r\n]/.test(value)

/** Blank text that renders nothing between two nodes of its fragment. */
interface Silent {
  node: Node
  previous: Node
  next: Node
}

/**
 * The text the compiler renders for each text node of a fragment (`clean_nodes`). Comments and
 * hoisted nodes leave the flow. Blank text at either end goes, and so does whitespace at the ends of
 * the fragment. Whitespace at the edge of a text becomes one space, or none after a text that already
 * ends with one, unless an expression is on that side. Whitespace inside a text stays.
 */
function renderedText(nodes: Node[], parent: string | undefined, preserve: boolean, silent: Silent[]): Map<Node, string> {
  const out = new Map<Node, string>()
  for (const node of nodes) {
    if (node.type === 'Text')
      out.set(node, preserve ? node.data : '')
  }
  if (preserve)
    return out
  const flow = nodes.filter(node => node.type !== 'Comment' && !HOISTED.has(node.type))
  let a = 0
  let b = flow.length
  while (a < b && flow[a]!.type === 'Text' && isBlank(flow[a]!.data))
    a++
  while (b > a && flow[b - 1]!.type === 'Text' && isBlank(flow[b - 1]!.data))
    b--
  const list = flow.slice(a, b)
  const data = list.map(node => node.type === 'Text' ? node.data as string : '')
  if (list[0]?.type === 'Text')
    data[0] = data[0]!.replace(START_RE, '')
  if (list.at(-1)?.type === 'Text')
    data[list.length - 1] = data.at(-1)!.replace(END_RE, '')
  const removable = parent !== undefined && NO_SPACE.has(parent)
  list.forEach((node, i) => {
    if (node.type !== 'Text')
      return
    const previous = list[i - 1]
    if (previous?.type !== 'ExpressionTag')
      data[i] = data[i]!.replace(START_RE, previous?.type === 'Text' && END_RE.test(data[i - 1]!) ? '' : ' ')
    if (list[i + 1]?.type !== 'ExpressionTag')
      data[i] = data[i]!.replace(END_RE, ' ')
    out.set(node, data[i] && (data[i] !== ' ' || !removable) ? data[i]! : '')
    if (!out.get(node) && isBlank(node.data))
      silent.push({ node, previous: list[i - 1]!, next: list[i + 1]! })
  })
  return out
}

/** The fragments a block or hoisted node renders, in source order. */
function fragments(node: Node): Node[][] {
  return Object.values(node)
    .filter((value): value is Node => value?.type === 'Fragment')
    .sort((x, y) => (x.start ?? 0) - (y.start ?? 0))
    .map(fragment => fragment.nodes)
}

function staticText(attribute: Node): string | undefined {
  const value = attribute.value
  return attribute.type === 'Attribute' && Array.isArray(value) && value.length === 1 && value[0].type === 'Text' ? value[0].data : undefined
}

function toNodes(code: string, nodes: Node[], parent: string | undefined, preserve: boolean, silent: Silent[]): MarkupNode[] {
  const rendered = renderedText(nodes, parent, preserve, silent)
  return nodes.map((node): MarkupNode => {
    const span = { start: node.start, end: node.end }
    if (node.type === 'Text')
      return { type: 'text', value: rendered.get(node)!, ...span }
    if (node.type === 'Comment')
      return { type: 'comment', ...span }
    if (node.type === 'ExpressionTag')
      return { type: 'expression', code: code.slice(node.expression.start, node.expression.end), ...span }
    if (!ELEMENTS.has(node.type))
      return { type: 'block', fragments: fragments(node).map(fragment => toNodes(code, fragment, undefined, preserve, silent)), ...span }
    const openEnd = code.indexOf('>', node.attributes.at(-1)?.end ?? node.start + 1 + node.name.length) + 1
    const element: ElementNode = {
      type: 'element',
      name: node.name,
      component: node.type !== 'RegularElement' && node.type !== 'TitleElement',
      structural: node.type === 'SlotElement',
      optOut: node.attributes.some((attribute: Node) => attribute.name === 'translate' && staticText(attribute) === 'no'),
      open: code.slice(node.start, openEnd),
      close: openEnd === node.end || code[openEnd - 2] === '/' ? '' : code.slice(code.lastIndexOf('</', node.end - 1), node.end),
      attributes: node.attributes.flatMap((attribute: Node): Attribute[] => {
        const value = staticText(attribute)
        return value === undefined ? [] : [{ name: attribute.name, value, start: attribute.start, end: attribute.end }]
      }),
      children: toNodes(code, node.fragment.nodes, node.type === 'RegularElement' ? node.name : undefined, preserve || node.name === 'pre' || node.name === 'textarea', silent),
      ...span,
    }
    return element
  })
}

function snippet(part: Part, id: number): string {
  switch (part.type) {
    case 'expression':
      return `{#snippet __p${id}()}{${part.code}}{/snippet}`
    case 'element':
      return `{#snippet __p${id}()}${part.source}{/snippet}`
    case 'wrapper':
      return `{#snippet __p${id}(__children)}${part.open}{@render __children()}${part.close}{/snippet}`
  }
}

/**
 * Parses a Svelte 5 component. A run renders through the `getDiglot()` store, or through
 * `<DiglotText>` with a snippet for each placeholder when it has elements.
 */
export async function parseSvelte(code: string): Promise<Parsed | undefined> {
  const { parse } = await import('svelte/compiler')
  const ast = parse(code, { modern: true }) as unknown as Node
  const instance = ast.instance as Node | null
  const silent: Silent[] = []
  const runs: Run[] = []
  const rewritten = (node: Node) => runs.some(run => run.start <= node.start && node.end <= run.end)
  const isText = (node: Node) => node.type === 'Text' && !rewritten(node)

  const emit: Emitter = {
    run(run: Run) {
      runs.push(run)
      if (run.parts.every(part => part.type === 'expression')) {
        const values = run.parts.length ? `, [${run.parts.map(part => `(${part.code})`).join(', ')}]` : ''
        return `{$__diglot('${run.hash}', ${literal(run.source)}${values})}`
      }
      return `<Diglot__Text t={$__diglot} h="${run.hash}" s={${literal(run.source)}}>${run.parts.map(snippet).join('')}</Diglot__Text>`
    },
    attribute(attribute, hash) {
      return `${attribute.name}={$__diglot('${hash}', ${literal(attribute.value)})}`
    },
    finish(s) {
      // A run becomes an expression, and the compiler keeps the whitespace next to an expression.
      for (const { node, previous, next } of silent) {
        if (!rewritten(node) && (rewritten(previous) || rewritten(next)) && !isText(previous) && !isText(next))
          s.remove(node.start, node.end)
      }
      const setup = `import { DiglotText as Diglot__Text, translate as __translate } from '@diglot/components/svelte'; const __diglot = __translate();`
      if (instance)
        s.appendLeft(instance.content.start, `\n${setup}\n`)
      else
        s.prepend(`<script>${setup}</script>`)
    },
  }
  return { nodes: toNodes(code, ast.fragment.nodes, undefined, ast.options?.preserveWhitespace === true, silent), emit }
}
