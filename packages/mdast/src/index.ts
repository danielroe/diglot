import type { ApplyReport, ApplySegmentEvent, AtomicNode, LinkNode, Placeholder, Policy, Resolution, Segment, SegmentTarget, Translations } from '@diglot/core'
import type { Format, MdNode, Parser } from './parse.ts'
import type { Span, Target, Unit } from './walk.ts'
import { buildSegment, createReport, createSegmentEvent, escapeText, normalise, resolvePolicy, resolveTranslation, tally, toSkeleton, yamlScalarSpan } from '@diglot/core'
import { isScalar, parseDocument } from 'yaml'
import { formatOf, parse } from './parse.ts'
import { walk } from './walk.ts'

export { parse } from './parse.ts'
export type { Format, MdNode, ParseOptions, Parser } from './parse.ts'

const BOM = '\uFEFF'

export interface ExtractOptions {
  /** File path recorded in segment contexts. */
  file?: string
  /** Markdown parser, `remark` by default. See {@link Parser}. */
  parser?: Parser
  /** `md` or `mdx`. Defaults to `mdx` when `file` ends in `.mdx`, and to `md` otherwise. */
  format?: Format
  policy?: Partial<Policy>
}

/** Extracts the segments of a markdown document. Protected spans are sliced from the source. */
export async function extract(source: string, options: ExtractOptions = {}): Promise<Segment[]> {
  if (source.startsWith(BOM))
    return extract(source.slice(BOM.length), options)
  const policy = resolvePolicy(options.policy)
  const segments: Segment[] = []
  for (const unit of walk(await parse(source, { parser: options.parser, format: options.format ?? formatOf(options.file) }), source, policy)) {
    const segment = buildSegment(unit.draft, { file: options.file ?? '', index: segments.length, policy })
    if (segment)
      segments.push(segment)
  }
  return segments
}

export interface ApplyOptions extends ExtractOptions {
  /** Called for each segment in extraction order. Attributes set on block-level targets are returned as `annotations`. */
  onSegment?: (event: ApplySegmentEvent) => void
}

/** Attributes for the block node of a segment, located in the applied markdown. */
export interface Annotation {
  /** mdast node type: `heading`, `paragraph` or `tableCell`. */
  type: string
  /** Start offset of the node in the applied markdown. */
  offset: number
  attributes: Record<string, string>
}

export interface Applied {
  markdown: string
  report: ApplyReport
  /** Attributes set from `onSegment`, for `annotate`. Present when `onSegment` is passed. */
  annotations?: Annotation[]
}

interface Edit {
  start: number
  end: number
  text: (nested: Edit[]) => string
}

/**
 * Applies translated skeletons (keyed by segment hash) to a markdown document. Each
 * translation is validated against the current source segment and spliced into the
 * source, so everything outside translated units is preserved byte for byte.
 */
export async function apply(source: string, translations: Translations, options: ApplyOptions = {}): Promise<Applied> {
  if (source.startsWith(BOM)) {
    const applied = await apply(source.slice(BOM.length), translations, options)
    return { ...applied, markdown: BOM + applied.markdown }
  }
  const policy = resolvePolicy(options.policy)
  const report = createReport()
  const lines = lineOffsets(source)
  const edits: Edit[] = []
  const attributes = new Map<MdNode, Record<string, string>>()
  let index = 0
  for (const unit of walk(await parse(source, { parser: options.parser, format: options.format ?? formatOf(options.file) }), source, policy)) {
    const segment = buildSegment(unit.draft, { file: options.file ?? '', index, policy })
    if (!segment)
      continue
    index++
    let resolution: Resolution = resolveTranslation(segment, translations)
    if (resolution.status === 'ok') {
      const edit = editFor(unit, resolution.skeleton, resolution.text, segment.placeholders, source, lines)
      if (typeof edit === 'string')
        resolution = { status: 'rejected', errors: [{ code: 'unaddressable', message: edit }], ...(resolution.record ? { record: resolution.record } : {}) }
      else
        edits.push(edit)
    }
    tally(report, segment, resolution)
    options.onSegment?.(createSegmentEvent(segment, resolution, blockTarget(unit.target, attributes)))
  }
  const { markdown, offset } = splice(source, edits)
  if (!options.onSegment)
    return { markdown, report }
  const annotations = [...attributes].map(([node, attrs]) => ({ type: node.type, offset: offset(node.position!.start.offset!), attributes: attrs }))
  return { markdown, report, annotations }
}

/**
 * Sets `annotations` as `data.hProperties` on the nodes of `tree`, which must be parsed from
 * the applied markdown. Paragraphs of tight list items, which mdast-util-to-hast renders
 * without a `<p>`, get `data.hName` `span` so the attributes are rendered.
 */
export function annotate(tree: MdNode, annotations: Annotation[]): void {
  const pending = new Map(annotations.map(a => [`${a.type}:${a.offset}`, a.attributes]))
  const visit = (node: MdNode, tight: boolean) => {
    const attrs = pending.get(`${node.type}:${node.position?.start.offset}`)
    if (attrs) {
      const data = node.data ??= {}
      data.hProperties = { ...data.hProperties, ...attrs }
      if (tight && node.type === 'paragraph')
        data.hName ??= 'span'
    }
    const inner = node.type === 'list' ? !isLoose(node) : node.type === 'listItem' && tight
    for (const child of node.children ?? [])
      visit(child, inner)
  }
  visit(tree, false)
}

function isLoose(list: MdNode): boolean {
  return Boolean(list.spread) || (list.children ?? []).some(item => item.spread ?? (item.children ?? []).length > 1)
}

function blockTarget(target: Target, attributes: Map<MdNode, Record<string, string>>): SegmentTarget | null {
  if (target.type !== 'range')
    return null
  return {
    setAttribute: (name, value) => {
      const attrs = attributes.get(target.node) ?? {}
      attrs[name] = value
      attributes.set(target.node, attrs)
    },
  }
}

function editFor(unit: Unit, skeleton: string, text: string, placeholders: Placeholder[], source: string, lines: number[]): Edit | string {
  const target: Target = unit.target
  switch (target.type) {
    case 'range': {
      const refs = toSkeleton(normalise(unit.draft.content as Exclude<Unit['draft']['content'], string>)).nodes
      return { start: target.start, end: target.end, text: nested => inject(skeleton, placeholders, refs, source, nested) }
    }
    case 'text':
      if (!target.escape && /[[\]]/.test(text))
        return 'label cannot contain brackets'
      return { start: target.start, end: target.end, text: () => target.escape ? escapeText(text) : text }
    case 'prop':
      return (target.node.type.startsWith('mdxJsx') ? jsxPropEdit(target.node, target.key, text, source) : propEdit(target.node, target.key, text, source)) ?? `prop ${target.key} not found in source`
    case 'frontmatter': {
      const start = source.indexOf('\n', target.node.position!.start.offset!) + 1
      return yamlEdit(target.node.value!, start, target.path, text) ?? 'frontmatter value not found'
    }
    case 'code': {
      const offset = codeOffset(target.node, target.comment.start, source, lines)
      return offset === undefined ? 'comment not found in source' : { start: offset, end: offset + target.comment.end - target.comment.start, text: () => text }
    }
  }
}

function inject(skeleton: string, placeholders: Placeholder[], refs: Array<LinkNode | AtomicNode>, source: string, nested: Edit[]): string {
  const slice = (start: number, end: number) => {
    let out = ''
    let last = start
    for (const edit of nested.filter(e => e.start >= start && e.end <= end).sort((a, b) => a.start - b.start)) {
      out += source.slice(last, edit.start) + edit.text([])
      last = edit.end
    }
    return out + source.slice(last, end)
  }
  return skeleton.replace(/\n/g, ' ').replace(/(?<!\\)\{(\/?)(\d+)\}/g, (match, closing: string, id: string) => {
    const placeholder = placeholders[Number(id)]
    const span = refs[Number(id)]?.data as Span | undefined
    if (!placeholder || !span)
      return match
    if (placeholder.close !== undefined)
      return closing ? slice(span.inner![1], span.end) : slice(span.start, span.inner![0])
    const value = slice(span.start, span.end)
    return placeholder.type === 'break' && value.startsWith(':') ? ` ${value} ` : value
  })
}

/** Edits nested inside another edit are handed to it. `offset` maps a source offset outside the edits to the output. */
function splice(source: string, edits: Edit[]): { markdown: string, offset: (at: number) => number } {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)
  const top: Array<{ edit: Edit, nested: Edit[] }> = []
  for (const edit of sorted) {
    const parent = top.at(-1)
    if (parent && edit.start >= parent.edit.start && edit.end <= parent.edit.end)
      parent.nested.push(edit)
    else
      top.push({ edit, nested: [] })
  }
  let out = ''
  let last = 0
  let shift = 0
  const shifts: Array<[end: number, shift: number]> = []
  for (const { edit, nested } of top) {
    const text = edit.text(nested)
    out += source.slice(last, edit.start) + text
    last = edit.end
    shift += text.length - (edit.end - edit.start)
    shifts.push([edit.end, shift])
  }
  return { markdown: out + source.slice(last), offset: at => at + (shifts.findLast(([end]) => end <= at)?.[1] ?? 0) }
}

function propEdit(node: MdNode, key: string, value: string, source: string): Edit | undefined {
  const start = node.position!.start.offset!
  const end = node.position!.end.offset!
  const text = source.slice(start, end)
  const yaml = /^(:{2,}[\w-][^\n]*\n)([ \t]*---\n)([\s\S]*?\n)[ \t]*---(?:\n|$)/.exec(text)
  if (yaml && node.fmAttributes && key in node.fmAttributes)
    return yamlEdit(yaml[3]!, start + yaml[1]!.length + yaml[2]!.length, [key], value)
  const head = /^:+[\w-]+(?:\[[^\]\n]*\])?\{[^\n]*?\}/.exec(text)?.[0] ?? ''
  const attr = new RegExp(`([\\s{])${key.replace(/-/g, '\\-')}=(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|([^\\s}"']+))`).exec(head)
  if (!attr)
    return
  const valueStart = start + attr.index + attr[1]!.length + key.length + 1
  const raw = attr[0].slice(attr[1]!.length + key.length + 1)
  const quote = !value.includes('"') ? '"' : !value.includes('\'') ? '\'' : undefined
  if (!quote)
    return
  return { start: valueStart, end: valueStart + raw.length, text: () => `${quote}${value}${quote}` }
}

/** Replaces a string attribute in the opening tag of an MDX JSX element. */
function jsxPropEdit(node: MdNode, key: string, value: string, source: string): Edit | undefined {
  const start = node.position!.start.offset!
  const tag = source.slice(start, openingTagEnd(source, start))
  const attr = new RegExp(`\\s${key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}=(?:"[^"]*"|'[^']*')`).exec(tag)
  const quote = !value.includes('"') ? '"' : !value.includes('\'') ? '\'' : undefined
  if (!attr || !quote)
    return
  const valueStart = start + attr.index + key.length + 2
  // MDX decodes character references in attribute strings, so a literal one is escaped.
  return { start: valueStart, end: start + attr.index + attr[0].length, text: () => `${quote}${value.replace(/&(?=#?\w+;)/g, '&amp;')}${quote}` }
}

/** The offset after the `>` that closes the opening tag at `start`, skipping quoted strings and expressions. */
function openingTagEnd(source: string, start: number): number {
  let quote = ''
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote)
        quote = ''
    }
    else if (ch === '"' || ch === '\'') {
      quote = ch
    }
    else if (ch === '{') {
      depth++
    }
    else if (ch === '}') {
      depth--
    }
    else if (ch === '>' && depth === 0) {
      return i + 1
    }
  }
  return source.length
}

function yamlEdit(yaml: string, offset: number, path: Array<string | number>, value: string): Edit | undefined {
  const doc = parseDocument(yaml, { keepSourceTokens: true })
  const node = doc.getIn(path, true)
  if (!isScalar(node) || !node.range)
    return
  const { start, end, suffix } = yamlScalarSpan(yaml, node.range[0], node.range[1])
  return { start: offset + start, end: offset + end, text: () => yamlScalar(value) + suffix }
}

function yamlScalar(value: string): string {
  return /^[\p{L}\p{N}][^:#\n"'{}[\],&*!|>%@`]*$/u.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value)
}

function lineOffsets(source: string): number[] {
  const offsets = [0]
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1))
    offsets.push(i + 1)
  return offsets
}

function codeOffset(node: MdNode, offsetInValue: number, source: string, lines: number[]): number | undefined {
  const value = node.value ?? ''
  const before = value.slice(0, offsetInValue)
  const line = before.split('\n').length - 1
  const column = offsetInValue - (before.lastIndexOf('\n') + 1)
  const sourceLine = node.position!.start.line + line
  const lineStart = lines[sourceLine]
  if (lineStart === undefined)
    return
  const sourceText = source.slice(lineStart, (lines[sourceLine + 1] ?? source.length + 1) - 1)
  const valueText = value.split('\n')[line]!
  if (!sourceText.endsWith(valueText))
    return
  return lineStart + sourceText.length - valueText.length + column
}
