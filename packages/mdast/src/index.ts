import type { ApplyReport, AtomicNode, LinkNode, Placeholder, Policy, Segment, Translations } from '@diglot/core'
import type { MdNode } from './parse.ts'
import type { Span, Target, Unit } from './walk.ts'
import { buildSegment, createReport, escapeText, normalise, resolvePolicy, resolveTranslation, tally, toSkeleton } from '@diglot/core'
import { isScalar, parseDocument } from 'yaml'
import { parse } from './parse.ts'
import { walk } from './walk.ts'

export { parse } from './parse.ts'
export type { MdNode } from './parse.ts'

export interface ExtractOptions {
  /** File path recorded in segment contexts. */
  file?: string
  policy?: Partial<Policy>
}

/** Extracts the segments of a markdown document. Protected spans are sliced from the source. */
export async function extract(source: string, options: ExtractOptions = {}): Promise<Segment[]> {
  const policy = resolvePolicy(options.policy)
  const segments: Segment[] = []
  for (const unit of walk(await parse(source), source, policy)) {
    const segment = buildSegment(unit.draft, { file: options.file ?? '', index: segments.length, policy })
    if (segment)
      segments.push(segment)
  }
  return segments
}

export interface Applied {
  markdown: string
  report: ApplyReport
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
export async function apply(source: string, translations: Translations, options: ExtractOptions = {}): Promise<Applied> {
  const policy = resolvePolicy(options.policy)
  const report = createReport()
  const lines = lineOffsets(source)
  const edits: Edit[] = []
  let index = 0
  for (const unit of walk(await parse(source), source, policy)) {
    const segment = buildSegment(unit.draft, { file: options.file ?? '', index, policy })
    if (!segment)
      continue
    index++
    const resolution = resolveTranslation(segment, translations)
    if (resolution.status !== 'ok') {
      tally(report, segment, resolution)
      continue
    }
    const edit = editFor(unit, resolution.skeleton, resolution.text, segment.placeholders, source, lines)
    if (typeof edit === 'string') {
      tally(report, segment, { status: 'rejected', errors: [{ code: 'unaddressable', message: edit }] })
      continue
    }
    tally(report, segment, resolution)
    edits.push(edit)
  }
  return { markdown: splice(source, edits), report }
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
      return propEdit(target.node, target.key, text, source) ?? `prop ${target.key} not found in source`
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

/** Edits nested inside another edit are handed to it. */
function splice(source: string, edits: Edit[]): string {
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
  for (const { edit, nested } of top) {
    out += source.slice(last, edit.start) + edit.text(nested)
    last = edit.end
  }
  return out + source.slice(last)
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

function yamlEdit(yaml: string, offset: number, path: Array<string | number>, value: string): Edit | undefined {
  const doc = parseDocument(yaml, { keepSourceTokens: true })
  const node = doc.getIn(path, true)
  if (!isScalar(node) || !node.range)
    return
  const [start, end] = node.range
  return { start: offset + start, end: offset + end, text: () => yamlScalar(value) }
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
