import type { CodeComment } from '@diglot/code'
import type { ApplyReport, ApplySegmentEvent, AtomicNode, LinkNode, Policy, Segment, SegmentDraft, SegmentTarget, SkeletonNode, Translations } from '@diglot/core'
import type { ElementNode, Node } from 'comark'
import type { InlineStats } from './inline.ts'
import type { ComarkDocument } from './tree.ts'
import type { Target, Unit } from './walk.ts'
import { commentDraft } from '@diglot/code'
import { createReport, createSegmentEvent, parseSkeleton, prepareSegment, resolvePolicy, resolveTranslation, setAtPath, tally } from '@diglot/core'
import { clone } from './clone.ts'
import { inlineNodes, toInline } from './inline.ts'
import { isElement } from './tree.ts'
import { walk } from './walk.ts'

export { applyNavigation, extractNavigation } from './navigation.ts'
export type { NavigationOptions } from './navigation.ts'
export { render } from './render.ts'
export { parse } from './tree.ts'
export type { ComarkDocument } from './tree.ts'

export interface ExtractOptions {
  /** File path recorded in segment contexts. */
  file?: string
  policy?: Partial<Policy>
  /**
   * Resolve the markdown of links and protected spans, by slicing `doc.source` or re-rendering.
   * Defaults to `true`. With `false`, placeholders get empty markdown and segment `text` and
   * `sourceHash` are not meaningful; `hash`, `skeleton`, placeholder types and `words` are unchanged.
   */
  spanSources?: boolean
}

export interface Extraction {
  segments: Segment[]
  /** How protected spans were obtained: sliced from `doc.source`, or re-rendered. */
  spans: InlineStats
}

/** Extracts the segments of a comark document. Pass a document from `parse` to slice protected spans from source. */
export async function extract(doc: ComarkDocument, options: ExtractOptions = {}): Promise<Extraction> {
  const policy = resolvePolicy(options.policy)
  const spans: InlineStats = { sliced: 0, rendered: 0 }
  const segments: Segment[] = []
  for (const unit of walk(doc, policy)) {
    const { segment } = await prepare(unit, options.file ?? '', segments.length, policy, spans, options.spanSources ?? true)
    if (segment)
      segments.push(segment)
  }
  return { segments, spans }
}

export interface ApplyOptions extends ExtractOptions {
  /**
   * Called for each segment in extraction order. Targets set props on the text block holding the
   * segment, or on a `span` wrapping it. Span sources are resolved only for this callback, unless
   * `spanSources` is `false`.
   */
  onSegment?: (event: ApplySegmentEvent) => void
  /**
   * Set to `false` to translate `doc` in place, for a document nothing else holds on to (such as
   * one parsed for this call). Defaults to `true`.
   */
  copy?: boolean
}

export interface Applied {
  doc: ComarkDocument
  report: ApplyReport
}

/**
 * Returns a copy of `doc` (or `doc` itself, with `copy: false`) with translations applied.
 * Translations are skeletons, keyed by segment hash; each is validated against the current
 * source segment, and its placeholders are replaced by the current source nodes. Segments
 * without a valid translation keep their source text. Heading ids are kept.
 */
export async function apply(doc: ComarkDocument, translations: Translations, options: ApplyOptions = {}): Promise<Applied> {
  const policy = resolvePolicy(options.policy)
  const out = options.copy === false ? doc : clone(doc)
  const spanSources = Boolean(options.onSegment) && options.spanSources !== false
  const report = createReport()
  const ranges: RangeEdit[] = []
  const attrs: Array<{ target: Extract<Target, { type: 'attr' }>, text: string }> = []
  const code = new Map<ElementNode, Array<{ comment: CodeComment, text: string }>>()
  let index = 0
  for (const unit of walk(out, policy)) {
    let prepared = prepare(unit, options.file ?? '', index, policy, undefined, spanSources)
    if (prepared instanceof Promise)
      prepared = await prepared
    const { segment, refs } = prepared
    if (!segment)
      continue
    index++
    const resolution = resolveTranslation(segment, translations)
    tally(report, segment, resolution)
    const { target } = unit
    const range: RangeEdit | undefined = target.type === 'range' ? { target } : undefined
    if (range)
      ranges.push(range)
    options.onSegment?.(createSegmentEvent(segment, resolution, range ? rangeTarget(range) : null))
    if (resolution.status !== 'ok')
      continue
    if (target.type === 'attr')
      attrs.push({ target, text: resolution.text })
    else if (target.type === 'frontmatter')
      setAtPath(out.frontmatter, target.path, resolution.text)
    else if (target.type === 'code')
      code.set(target.element, [...(code.get(target.element) ?? []), { comment: target.comment, text: resolution.text }])
    else if (range)
      range.build = () => keepEdges(target.parent.slice(target.start, target.end), buildNodes(parseSkeleton(resolution.skeleton, segment.placeholders), refs))
  }
  for (const { target, text } of attrs)
    target.attrs[target.key] = text
  for (const [element, edits] of code)
    replaceText(element, edits)
  for (const { target, build, wrap } of ranges.reverse()) {
    if (!build && !wrap)
      continue
    const nodes = build ? build() : target.parent.slice(target.start, target.end)
    target.parent.splice(target.start, target.end - target.start, ...(wrap ? keepEdges(nodes, [['span', wrap, ...trimEdges(nodes)] as ElementNode]) : nodes))
  }
  return { doc: out, report }
}

interface RangeEdit {
  target: Extract<Target, { type: 'range' }>
  build?: () => Node[]
  /** Attributes of a `span` wrapping the range. */
  wrap?: Record<string, string>
}

const TEXT_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'th', 'td'])

function rangeTarget(range: RangeEdit): SegmentTarget {
  const { parent, start, end } = range.target
  const element = parent as unknown as ElementNode
  const own = start === 2 && end === parent.length && isElement(element) && TEXT_BLOCKS.has(element[0])
  return {
    setAttribute: (name, value) => {
      const attrs = own ? element[1] : (range.wrap ??= {})
      attrs[name] = value
    },
  }
}

interface Prepared {
  segment?: Segment
  refs: Array<LinkNode | AtomicNode>
}

/** A promise only when span sources have to be resolved. */
function prepare(unit: Unit, file: string, index: number, policy: Policy, spans: InlineStats | undefined, spanSources: boolean): Prepared | Promise<Prepared> {
  if (spanSources && Array.isArray(unit.content))
    return toInline(unit.content, unit.slicer, spans).then(content => prepareDraft({ kind: unit.kind, content, context: unit.context, position: unit.position }, file, index, policy, true))
  let draft: SegmentDraft
  let resolvedSources = true
  if (typeof unit.content === 'string') {
    draft = { kind: unit.kind, content: unit.content, context: unit.context, position: unit.position }
  }
  else if (Array.isArray(unit.content)) {
    draft = { kind: unit.kind, content: inlineNodes(unit.content), context: unit.context, position: unit.position }
    resolvedSources = false
  }
  else {
    draft = { ...commentDraft(unit.content, unit.language!, unit.context), position: unit.position }
  }
  return prepareDraft(draft, file, index, policy, resolvedSources)
}

function prepareDraft(draft: SegmentDraft, file: string, index: number, policy: Policy, resolvedSources: boolean): Prepared {
  const prepared = prepareSegment(draft, { file, index, policy, resolvedSources })
  return { segment: prepared?.segment, refs: prepared?.nodes ?? [] }
}

const TAGS = { strong: 'strong', emphasis: 'em', delete: 'del' } as const

function trimEdges(nodes: Node[]): Node[] {
  const out = [...nodes]
  if (typeof out[0] === 'string')
    out[0] = out[0].trimStart()
  if (typeof out.at(-1) === 'string')
    out[out.length - 1] = (out.at(-1) as string).trimEnd()
  return out.filter(node => node !== '')
}

function keepEdges(range: Node[], nodes: Node[]): Node[] {
  const first = range[0]
  const last = range.at(-1)
  const lead = typeof first === 'string' ? first.slice(0, first.length - first.trimStart().length) : ''
  const trail = typeof last === 'string' ? last.slice(last.trimEnd().length) : ''
  const out = [...nodes]
  if (lead && typeof out[0] === 'string')
    out[0] = lead + out[0]
  else if (lead)
    out.unshift(lead)
  if (trail && typeof out.at(-1) === 'string')
    out[out.length - 1] += trail
  else if (trail)
    out.push(trail)
  return out
}

function buildNodes(nodes: SkeletonNode[], refs: Array<LinkNode | AtomicNode>): Node[] {
  const out: Node[] = []
  const push = (node: Node) => {
    if (typeof node === 'string' && typeof out.at(-1) === 'string')
      out[out.length - 1] += node
    else
      out.push(node)
  }
  for (const node of nodes) {
    if (node.type === 'text') {
      push(node.value)
      continue
    }
    if (node.type !== 'placeholder') {
      push([TAGS[node.type], {}, ...buildNodes(node.children, refs)])
      continue
    }
    const data = refs[node.id]?.data as Node
    if (typeof data === 'string')
      push(data)
    else if (node.children && isElement(data))
      push([data[0], clone(data[1]), ...buildNodes(node.children, refs)])
    else
      push(clone(data))
  }
  return out
}

/** Offsets refer to the concatenated text of `element`, which may be split across highlighted spans. */
function replaceText(element: ElementNode, edits: Array<{ comment: CodeComment, text: string }>): void {
  const leaves: Array<{ parent: Node[], index: number, start: number, end: number }> = []
  let offset = 0
  const collect = (node: ElementNode) => {
    for (let i = 2; i < node.length; i++) {
      const child = node[i] as Node
      if (typeof child === 'string') {
        leaves.push({ parent: node as unknown as Node[], index: i, start: offset, end: offset + child.length })
        offset += child.length
      }
      else if (isElement(child)) {
        collect(child)
      }
    }
  }
  collect(element)
  for (const { comment, text } of [...edits].sort((a, b) => b.comment.start - a.comment.start)) {
    let first = true
    for (const leaf of leaves) {
      if (leaf.end <= comment.start || leaf.start >= comment.end)
        continue
      const value = leaf.parent[leaf.index] as string
      const from = Math.max(comment.start, leaf.start) - leaf.start
      const to = Math.min(comment.end, leaf.end) - leaf.start
      leaf.parent[leaf.index] = value.slice(0, from) + (first ? text : '') + value.slice(to)
      first = false
    }
  }
}
