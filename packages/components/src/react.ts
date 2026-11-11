import type { Attribute, BlockNode, ElementNode, Emitter, MarkupNode, Parsed, Part, Run, Span, TextNode } from './markup.ts'
import { literal } from './markup.ts'

/** oxc's ESTree, read loosely: only the node types JSX extraction needs. */
type Node = Record<string, any> & Span & { type: string }

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
  shy: '­',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  hellip: '…',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  minus: '−',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  iexcl: '¡',
  iquest: '¿',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  hearts: '♥',
  star: '☆',
  check: '✓',
}

function decode(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]\w*));/gi, (match, decimal?: string, hex?: string, name?: string) => {
    if (name)
      return ENTITIES[name] ?? match
    const point = decimal ? Number(decimal) : Number.parseInt(hex!, 16)
    return point <= 0x10FFFF ? String.fromCodePoint(point) : match
  })
}

/** The text JSX renders: each line trimmed where it meets a line break, blank lines dropped, the rest joined by one space. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|[\n\r\u2028\u2029]/)
  const last = lines.length - 1
  return decode(lines
    .map((line, i) => {
      if (i > 0)
        line = line.replace(/^[^\S\n\r\u2028\u2029]+/, '')
      if (i < last)
        line = line.replace(/[^\S\n\r\u2028\u2029]+$/, '')
      return line
    })
    .filter(Boolean)
    .join(' '))
}

const isJsx = (node: Node | undefined) => node?.type === 'JSXElement' || node?.type === 'JSXFragment'
const isFunction = (node: Node | undefined) => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression' || node?.type === 'FunctionDeclaration'
const isCapitalised = (name: unknown) => typeof name === 'string' && /^[A-Z]/.test(name)
const isDirective = (node: Node) => typeof node.directive === 'string'

/** The outermost JSX elements and fragments under a node, without descending into them. */
function jsxRoots(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node)
      jsxRoots(child, out)
  }
  else if (isJsx(node as Node)) {
    out.push(node as Node)
  }
  else if (node && typeof node === 'object') {
    for (const key in node) {
      if (key !== 'parent')
        jsxRoots((node as Node)[key], out)
    }
  }
  return out
}

function tagName(node: Node): string {
  if (node.type === 'JSXIdentifier')
    return node.name
  if (node.type === 'JSXNamespacedName')
    return `${node.namespace.name}:${node.name.name}`
  return `${tagName(node.object)}.${node.property.name}`
}

function part(part: Part): string {
  switch (part.type) {
    case 'expression':
      return `(${part.code})`
    case 'element':
      return `(${part.source})`
    case 'wrapper':
      return `__children => (${part.open}{__children}${part.close})`
  }
}

const attributeName = (node: Node): string => node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' ? node.name.name : ''
const stringValue = (node: Node): string | undefined => node.type === 'JSXAttribute' && node.value?.type === 'Literal' && typeof node.value.value === 'string' ? node.value.value : undefined

/**
 * Parses a JSX or TSX module. Every outermost JSX element or fragment is a root, and JSX inside
 * `{…}` is control flow, walked as a block. A run renders as `<DiglotText>`, which works anywhere JSX
 * does. Attributes call the `useDiglot()` that the rewrite adds to the top of their component, and
 * are left alone outside a component.
 */
export async function parseReact(code: string, file: string): Promise<Parsed | undefined> {
  const { parseSync } = await import('oxc-parser')
  const { program, errors } = parseSync(file, code, { lang: file.replace(/[?#].*$/, '').endsWith('.jsx') ? 'jsx' : 'tsx', sourceType: 'module' })
  if (errors.some(error => error.severity === 'Error'))
    return

  const span = (node: Node) => ({ start: node.start, end: node.end })
  const block = (roots: Node[], at: Node): BlockNode => ({ type: 'block', fragments: roots.map(fragment), ...span(at) })
  const text = (node: Node, value: string): TextNode => ({ type: 'text', value, ...span(node) })

  function fragment(root: Node): MarkupNode[] {
    return root.type === 'JSXElement' ? [element(root)] : children(root.children)
  }

  function children(nodes: Node[]): MarkupNode[] {
    return nodes.map((node): MarkupNode => {
      if (node.type === 'JSXText')
        return text(node, jsxText(node.value))
      if (node.type === 'JSXElement')
        return element(node)
      if (node.type === 'JSXFragment')
        return block([node], node)
      const expression = node.expression as Node | undefined
      if (expression?.type === 'JSXEmptyExpression')
        return { type: 'comment', ...span(node) }
      // Formatters write `{" "}` for a space at the end of a line.
      if (expression?.type === 'Literal' && typeof expression.value === 'string' && /^ +$/.test(expression.value))
        return text(node, expression.value)
      const roots = jsxRoots(expression)
      if (roots.length || node.type !== 'JSXExpressionContainer')
        return block(roots, node)
      return { type: 'expression', code: code.slice(expression!.start, expression!.end), ...span(node) }
    })
  }

  function element(node: Node): ElementNode {
    const opening = node.openingElement as Node
    const name = tagName(opening.name)
    const props = opening.attributes as Node[]
    const attributes = props.flatMap((prop): Attribute[] => {
      const value = stringValue(prop)
      return value === undefined || !attributeName(prop) ? [] : [{ name: attributeName(prop), value: decode(value), ...span(prop) }]
    })
    // JSX passed in props, such as `icon={<Icon />}`, is walked on its own, before the children.
    const inProps = jsxRoots(props)
    const kids = children(node.children)
    return {
      type: 'element',
      name,
      component: opening.name.type === 'JSXMemberExpression' || isCapitalised(name),
      structural: props.some(prop => attributeName(prop) === 'dangerouslySetInnerHTML'),
      optOut: props.some(prop => attributeName(prop) === 'translate' && stringValue(prop) === 'no'),
      open: code.slice(node.start, opening.end),
      close: node.closingElement ? code.slice(node.closingElement.start, node.closingElement.end) : '',
      attributes,
      children: inProps.length ? [block(inProps, opening), ...kids] : kids,
      ...span(node),
    }
  }

  const roots: Node[] = []
  /** Outermost component functions. */
  const components: Node[] = []
  function scan(node: unknown, inComponent: boolean) {
    if (Array.isArray(node)) {
      for (const child of node)
        scan(child, inComponent)
      return
    }
    if (!node || typeof node !== 'object')
      return
    const current = node as Node
    if (isJsx(current)) {
      roots.push(current)
      return
    }
    if (!inComponent) {
      const fn = current.type === 'FunctionDeclaration' && isCapitalised(current.id?.name)
        ? current
        : current.type === 'VariableDeclarator' && isCapitalised(current.id?.name) && isFunction(current.init)
          ? current.init
          : current.type === 'ExportDefaultDeclaration' && isFunction(current.declaration)
            ? current.declaration
            : undefined
      if (fn) {
        components.push(fn)
        inComponent = true
      }
    }
    for (const key in current) {
      if (key !== 'parent')
        scan(current[key], inComponent)
    }
  }
  scan(program.body, false)

  const hooked = new Set<Node>()
  const emit: Emitter = {
    run(run: Run) {
      return `<__DiglotText h="${run.hash}" s={${literal(run.source)}}${run.parts.length ? ` p={[${run.parts.map(part).join(', ')}]}` : ''} />`
    },
    attribute(attribute, hash) {
      const fn = components.find(component => component.start <= attribute.start && attribute.end <= component.end)
      if (!fn)
        return
      hooked.add(fn)
      return `${attribute.name}={__diglot('${hash}', ${literal(attribute.value)})}`
    },
    finish(s) {
      const hook = 'const __diglot = __useTranslate();'
      for (const fn of hooked) {
        const body = fn.body as Node
        if (body.type === 'BlockStatement' || body.type === 'FunctionBody') {
          s.appendLeft((body.body as Node[]).filter(isDirective).at(-1)?.end ?? body.start + 1, ` ${hook}`)
        }
        else {
          s.appendLeft(body.start, `{ ${hook} return (`)
          s.appendRight(body.end, '); }')
        }
      }
      const directive = (program.body as Node[]).filter(isDirective).at(-1)
      const imports = `import { DiglotText as __DiglotText, useTranslate as __useTranslate } from '@diglot/components/react';\n`
      if (directive)
        s.appendLeft(directive.end, `\n${imports}`)
      else
        s.prepend(imports)
    },
  }

  return { nodes: [block(roots, program as unknown as Node)], emit }
}
