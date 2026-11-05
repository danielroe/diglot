import type { CodeComment } from '@diglot/code'
import type { InlineNode, Policy, SegmentDraft, SegmentKind, SegmentPosition, ValuePath } from '@diglot/core'
import type { MdNode, MdxJsxAttribute } from './parse.ts'
import { commentDraft, findComments } from '@diglot/code'
import { BREAK_SOURCE, kebabCase, kindForContainers, proseProps, stringsAtPaths } from '@diglot/core'
import { parse as parseYaml } from 'yaml'

/** Source offsets behind a placeholder. Paired links also record where their text starts and ends. */
export interface Span {
  start: number
  end: number
  inner?: [number, number]
}

export type Target
  = | { type: 'range', node: MdNode, start: number, end: number }
    | { type: 'text', start: number, end: number, escape: boolean }
    | { type: 'prop', node: MdNode, key: string }
    | { type: 'frontmatter', node: MdNode, path: ValuePath }
    | { type: 'code', node: MdNode, comment: CodeComment }

export interface Unit {
  draft: SegmentDraft
  target: Target
}

const HEADING_ATTRS_RE = /\s*\{[^{}]*\}\s*$/

const FLOW = new Set(['blockquote', 'code', 'containerDirective', 'definition', 'footnoteDefinition', 'heading', 'leafDirective', 'list', 'listItem', 'math', 'mdxFlowExpression', 'mdxJsxFlowElement', 'mdxjsEsm', 'paragraph', 'table', 'thematicBreak', 'yaml'])

/** Lists the translatable units of an mdast tree in document order. */
export function walk(root: MdNode, source: string, policy: Policy): Unit[] {
  const units: Unit[] = []
  let trail: string[] = []
  const at = (n: MdNode, edge: 'start' | 'end') => n.position![edge].offset!
  const position = (n: MdNode): SegmentPosition => ({ startLine: n.position?.start.line ?? 1, endLine: n.position?.end.line ?? 1, precision: 'node' })
  const context = (containers: string[], detail?: string) => ({ headingTrail: trail.filter(Boolean), containers, ...(detail ? { detail } : {}) })
  const push = (kind: SegmentKind, content: SegmentDraft['content'], node: MdNode, containers: string[], target: Target, detail?: string) => {
    units.push({ draft: { kind, content, context: context(containers, detail), position: position(node) }, target })
  }

  const toInline = (nodes: MdNode[], containerEnd?: number): InlineNode[] => {
    const out: InlineNode[] = []
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      const span: Span = { start: at(n, 'start'), end: attributesEnd(source, at(n, 'end'), nodes[i + 1] ? at(nodes[i + 1]!, 'start') : containerEnd) }
      const atomic = (kind: Extract<InlineNode, { type: 'atomic' }>['kind'], extra: Partial<Extract<InlineNode, { type: 'atomic' }>> = {}) =>
        out.push({ type: 'atomic', kind, source: source.slice(span.start, span.end), data: span, ...extra })
      switch (n.type) {
        case 'text':
          out.push({ type: 'text', value: n.value! })
          break
        case 'strong':
        case 'emphasis':
        case 'delete':
          out.push({ type: n.type, children: toInline(n.children!, n.children!.length ? at(n.children!.at(-1)!, 'end') : undefined) })
          break
        case 'inlineCode':
          atomic('code')
          break
        case 'break':
          out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE, data: span })
          break
        case 'image':
          atomic('image')
          break
        case 'link': {
          const kids = n.children ?? []
          if (!kids.length) {
            atomic('link')
            break
          }
          span.inner = [at(kids[0]!, 'start'), at(kids.at(-1)!, 'end')]
          out.push({ type: 'link', children: toInline(kids, span.inner[1]), open: source.slice(span.start, span.inner[0]), close: source.slice(span.inner[1], span.end), data: span })
          break
        }
        case 'textComponent':
          if (n.name === 'br') {
            out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE, data: span })
          }
          else if (n.name === 'binding') {
            if (source.startsWith('{{', span.start - 2))
              span.start -= 2
            if (source.startsWith('}}', span.end))
              span.end += 2
            atomic('binding')
          }
          else {
            atomic('component', component(n))
          }
          break
        case 'textDirective':
          if (source.slice(span.start, span.end) === `:${n.name}`)
            out.push({ type: 'text', value: source.slice(span.start, span.end) })
          else
            atomic('component', component(n))
          break
        case 'mdxTextExpression':
          atomic('binding')
          break
        case 'mdxJsxTextElement':
          atomic('component', { name: n.name ?? undefined, ...(/\p{L}/u.test(textOf(n.children ?? [])) ? { hidesText: true } : {}) })
          break
        case 'html': {
          if (/^<\/?br\s*\/?>$/i.test(n.value!)) {
            out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE, data: span })
            break
          }
          const open = /^<([a-z][\w-]*)(?:\s[^>]*)?>$/i.exec(n.value!)
          const closeAt = open ? nodes.findIndex((m, j) => j > i && m.type === 'html' && m.value === `</${open[1]}>`) : -1
          if (closeAt >= 0) {
            span.end = at(nodes[closeAt]!, 'end')
            i = closeAt
          }
          atomic('html', open ? { name: open[1] } : {})
          break
        }
        default:
          atomic('other')
      }
    }
    return out
  }

  const inline = (kind: SegmentKind, nodes: MdNode[], node: MdNode, containers: string[], detail?: string) => {
    for (const image of findImages(nodes)) {
      if (image.alt?.trim()) {
        const start = at(image, 'start') + 2
        const end = closingBracket(source, start - 1)
        if (end > start)
          push('image-alt', image.alt, image, containers, { type: 'text', start, end, escape: true }, 'alt')
      }
    }
    if (!nodes.length)
      return
    const end = kind === 'heading' ? at(nodes.at(-1)!, 'end') : Math.max(at(nodes.at(-1)!, 'end'), at(node, 'end'))
    const content = toInline(nodes, end)
    const lastSpan = (content.at(-1) as { data?: Span } | undefined)?.data
    const contentEnd = Math.max(at(nodes.at(-1)!, 'end'), lastSpan?.end ?? 0)
    push(kind, content, node, containers, { type: 'range', node, start: at(nodes[0]!, 'start'), end: contentEnd }, detail)
  }

  const props = (node: MdNode, containers: string[]) => {
    const attrs = Array.isArray(node.attributes) ? jsxAttributes(node.attributes) : { ...node.fmAttributes, ...node.attributes }
    for (const prop of proseProps(policy, node.name!)) {
      const key = Object.keys(attrs).find(k => k === prop || k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) === prop)
      const value = key ? attrs[key] : undefined
      if (typeof value === 'string' && value.trim())
        push('prop', value, node, containers, { type: 'prop', node, key: key! }, prop)
    }
  }

  function visit(n: MdNode, containers: string[], synced: boolean) {
    switch (n.type) {
      case 'yaml': {
        const data = parseYaml(n.value!) ?? {}
        for (const [path, value] of stringsAtPaths(data, policy.frontmatter))
          units.push({ draft: { kind: 'frontmatter', content: value, context: context([], path.join('.')), position: { startLine: 1, endLine: 1, precision: 'file' } }, target: { type: 'frontmatter', node: n, path } })
        return
      }
      case 'heading': {
        const kids = stripHeadingAttributes(n.children!, source)
        inline('heading', kids, n, containers, `h${n.depth}`)
        const level = n.depth!
        trail = Array.from({ length: level }, (_, i) => i < level - 1 ? (trail[i] ?? '') : textOf(kids))
        return
      }
      case 'paragraph': {
        const kids = n.children!.filter(c => !(c.type === 'text' && !c.value!.trim()))
        if (kids.length === 1 && kids[0]!.type === 'textComponent' && kids[0]!.name !== 'br' && kids[0]!.name !== 'binding') {
          props(kids[0]!, [...containers, kids[0]!.name!])
          return
        }
        // remark-mdx wraps JSX elements that stand on their own lines in a paragraph, where Sätteri reads blocks.
        if (kids.length && kids.every(c => c.type === 'mdxJsxTextElement' && c.name)) {
          for (const kid of kids)
            jsx(kid, containers, synced)
          return
        }
        return inline(kindForContainers(containers, policy), n.children!, n, containers)
      }
      case 'tableCell':
        return inline('table-cell', n.children!, n, containers)
      case 'code':
        return code(n, containers, synced)
      case 'html':
      case 'thematicBreak':
      case 'mdxjsEsm':
      case 'mdxFlowExpression':
        return
      case 'mdxJsxFlowElement':
        return n.name ? jsx(n, containers, synced) : visitChildren(n, containers, synced)
      case 'list':
      case 'table':
      case 'tableRow':
        for (const child of n.children!)
          visit(child, n.type === 'table' ? [...containers, 'table'] : containers, synced)
        return
      case 'listItem':
      case 'blockquote':
        for (const child of n.children!)
          visit(child, [...containers, n.type === 'listItem' ? 'li' : 'blockquote'], synced)
        return
      case 'textComponent':
        props(n, [...containers, n.name!])
        return
      case 'containerDirective':
      case 'containerComponent': {
        const inner = [...containers, n.name!]
        props(n, inner)
        const sync = synced || (n.name === 'code-group' && ((!Array.isArray(n.attributes) && n.attributes?.sync !== undefined) || n.fmAttributes?.sync !== undefined))
        for (const child of n.children!)
          visit(child, inner, sync)
        return
      }
      case 'componentContainerSection': {
        const inner = [...containers.slice(0, -1), `${containers.at(-1)}#${n.name}`]
        for (const child of n.children!)
          visit(child, inner, synced)
        return
      }
      default:
        for (const child of n.children ?? [])
          visit(child, containers, synced)
    }
  }

  /**
   * An MDX JSX element with a name: its string props, then its content. An element that holds
   * inline content, such as `<Aside>Text</Aside>` on one line, is one unit, whether the parser
   * reads it as a block (Sätteri) or as a paragraph around an inline element (remark-mdx).
   */
  function jsx(n: MdNode, containers: string[], synced: boolean) {
    const inner = [...containers, kebabCase(n.name!)]
    props(n, inner)
    const kids = n.children ?? []
    if (kids.length && kids.every(c => !FLOW.has(c.type)))
      return inline(kindForContainers(inner, policy), kids, n, inner)
    visitChildren(n, inner, synced)
  }

  function visitChildren(n: MdNode, containers: string[], synced: boolean) {
    for (const child of n.children ?? [])
      visit(child, containers, synced)
  }

  function code(n: MdNode, containers: string[], synced: boolean) {
    const lineEnd = source.indexOf('\n', at(n, 'start'))
    const fenceLine = source.slice(at(n, 'start'), lineEnd < 0 ? undefined : lineEnd)
    const label = /\[([^\]]+)\]/.exec(n.meta ?? '')
    if (label && !synced && policy.codeLabel(label[1]!)) {
      const offset = fenceLine.indexOf(label[0])
      if (offset >= 0)
        push('code-label', label[1]!, n, containers, { type: 'text', start: at(n, 'start') + offset + 1, end: at(n, 'start') + offset + 1 + label[1]!.length, escape: false }, 'filename')
    }
    if (!policy.codeComments || !n.lang)
      return
    for (const comment of findComments(n.value ?? '', n.lang)) {
      const line = n.position!.start.line + 1 + comment.line
      units.push({
        draft: { ...commentDraft(comment, n.lang, context(containers, n.lang)), position: { startLine: line, endLine: line, precision: 'node' } },
        target: { type: 'code', node: n, comment },
      })
    }
  }

  for (const child of root.children ?? [])
    visit(child, [], false)
  return units
}

/** remark-mdc leaves heading attributes (`## Title {#id}`) in the text; they are not part of the heading. */
function stripHeadingAttributes(nodes: MdNode[], source: string): MdNode[] {
  const last = nodes.at(-1)
  if (last?.type !== 'text' || !HEADING_ATTRS_RE.test(last.value!))
    return nodes
  const kept = last.value!.replace(HEADING_ATTRS_RE, '')
  const end = last.position!.start.offset! + source.slice(last.position!.start.offset!, last.position!.end.offset!).replace(HEADING_ATTRS_RE, '').length
  const trimmed: MdNode = { ...last, value: kept, position: { start: last.position!.start, end: { ...last.position!.end, offset: end } } }
  return kept ? [...nodes.slice(0, -1), trimmed] : nodes.slice(0, -1)
}

/** remark-mdc attaches `{...}` attributes to the preceding inline node without covering them in its position. */
function attributesEnd(source: string, end: number, limit: number | undefined): number {
  if (source[end] !== '{' || (limit !== undefined && limit <= end))
    return end
  const close = source.indexOf('}', end)
  return close >= 0 && (limit === undefined || close < limit) ? close + 1 : end
}

/** The string attributes of an MDX JSX element. Expression and spread attributes have no translatable value. */
function jsxAttributes(attributes: MdxJsxAttribute[]): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const attr of attributes) {
    if (attr.type === 'mdxJsxAttribute' && attr.name && typeof attr.value === 'string')
      attrs[attr.name] = attr.value
  }
  return attrs
}

function closingBracket(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\')
      i++
    else if (ch === '[')
      depth++
    else if (ch === ']' && --depth === 0)
      return i
  }
  return -1
}

function findImages(nodes: MdNode[]): MdNode[] {
  return nodes.flatMap(n => n.type === 'image' ? [n] : findImages(n.children ?? []))
}

function component(n: MdNode): { name?: string, hidesText?: true } {
  return { name: n.name ?? undefined, ...(/\p{L}/u.test(textOf(n.children ?? [])) ? { hidesText: true as const } : {}) }
}

function textOf(nodes: MdNode[]): string {
  return nodes.map(n => n.value ?? textOf(n.children ?? [])).join('')
}
