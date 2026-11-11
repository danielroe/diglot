import type { SFCTemplateBlock } from '@vue/compiler-sfc'
import type { Attribute, ElementNode, Emitter, MarkupNode, Parsed, Part, Run } from '../markup.ts'
import { literal } from '../markup.ts'

type TemplateChildNode = NonNullable<SFCTemplateBlock['ast']>['children'][number]
type VueElement = Extract<TemplateChildNode, { tagType: unknown }>

// `NodeTypes` and `ElementTypes` of `@vue/compiler-core`, which the SFC compiler does not re-export as values.
const ELEMENT = 1
const TEXT = 2
const COMMENT = 3
const INTERPOLATION = 5
const ATTRIBUTE = 6
const DIRECTIVE = 7
const COMPONENT = 1

/** Directives that make an element conditional or repeated, or replace its content. */
const STRUCTURAL = new Set(['if', 'else-if', 'else', 'for', 'slot', 'html', 'text', 'memo', 'once'])

/** `v-pre`, which the parser leaves out of the props of its element. */
const V_PRE_RE = /^<[^>]*\sv-pre[\s>/=]/

const isBlank = (value: string) => !/[^\t\r\n\f ]/.test(value)

/**
 * The text Vue renders for a child under `whitespace: 'condense'`: blank text first or last, or
 * between two elements across a newline, renders nothing; other blank text renders one space;
 * other text has its whitespace runs condensed.
 */
function rendered(children: TemplateChildNode[], i: number): string {
  const content = (children[i] as { content: string }).content
  if (!isBlank(content))
    return content.replace(/[\t\r\n\f ]+/g, ' ')
  const previous = children[i - 1]?.type
  const next = children[i + 1]?.type
  if (previous === undefined || next === undefined)
    return ''
  if ((previous === COMMENT && (next === COMMENT || next === ELEMENT)) || (previous === ELEMENT && (next === COMMENT || (next === ELEMENT && /[\r\n]/.test(content)))))
    return ''
  return ' '
}

function toNodes(code: string, children: TemplateChildNode[]): MarkupNode[] {
  return children.flatMap((node, i): MarkupNode[] => {
    const span = { start: node.loc.start.offset, end: node.loc.end.offset }
    switch (node.type) {
      case TEXT:
        return [{ type: 'text', value: rendered(children, i), ...span }]
      case COMMENT:
        return [{ type: 'comment', ...span }]
      case INTERPOLATION:
        return [{ type: 'expression', code: (node.content as { content: string }).content, ...span }]
      case ELEMENT:
        return [toElement(code, node as VueElement)]
      default:
        return []
    }
  })
}

function toElement(code: string, node: VueElement): ElementNode {
  const start = node.loc.start.offset
  const end = node.loc.end.offset
  const props = node.props
  const openEnd = code.indexOf('>', props.at(-1)?.loc.end.offset ?? start + 1 + node.tag.length) + 1
  const attributes: Attribute[] = props.flatMap(prop => prop.type === ATTRIBUTE && prop.value
    ? [{ name: prop.name, value: prop.value.content, start: prop.loc.start.offset, end: prop.loc.end.offset }]
    : [])
  return {
    type: 'element',
    name: node.tag,
    component: node.tagType === COMPONENT,
    structural: props.some(prop => prop.type === DIRECTIVE && STRUCTURAL.has(prop.name)),
    optOut: attributes.some(a => a.name === 'translate' && a.value === 'no') || V_PRE_RE.test(code.slice(start, openEnd)),
    open: code.slice(start, openEnd),
    close: node.isSelfClosing || openEnd === end ? '' : code.slice(code.lastIndexOf('</', end - 1), end),
    attributes,
    children: toNodes(code, node.children),
    start,
    end,
  }
}

function slot(part: Part, id: number): string {
  switch (part.type) {
    case 'expression':
      return `<template #${id}>{{ ${part.code} }}</template>`
    case 'element':
      return `<template #${id}>${part.source}</template>`
    case 'wrapper':
      return `<template #${id}="{ __children }">${part.open}<component :is="__children" />${part.close}</template>`
  }
}

const emit: Emitter = {
  run(run: Run) {
    if (run.parts.every(part => part.type === 'expression')) {
      const values = run.parts.length ? `, [${run.parts.map(part => `(${part.code})`).join(', ')}]` : ''
      return `{{ $diglot('${run.hash}', ${literal(run.source)}${values}) }}`
    }
    return `<DiglotText h="${run.hash}" :s="${literal(run.source)}">${run.parts.map(slot).join('')}</DiglotText>`
  },
  attribute(attribute, hash) {
    return `:${attribute.name}="$diglot('${hash}', ${literal(attribute.value)})"`
  },
}

/** Parses the template of a single-file component. Templates in another language than HTML are left alone. */
export async function parseVue(code: string, file: string): Promise<Parsed | undefined> {
  const { parse } = await import('@vue/compiler-sfc')
  const { descriptor } = parse(code, { filename: file, sourceMap: false, ignoreEmpty: false })
  const template = descriptor.template
  if (!template?.ast || (template.lang && template.lang !== 'html'))
    return
  return { nodes: toNodes(code, template.ast.children), emit }
}
