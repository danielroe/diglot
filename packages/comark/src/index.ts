import type { CodeComment } from '@diglot/code'
import type { ApplyReport, ApplySegmentEvent, AtomicNode, LinkNode, Policy, Segment, SegmentDraft, SegmentTarget, SkeletonNode, Translations } from '@diglot/core'
import type { ElementNode, Node } from 'comark'
import type { InlineStats } from './inline.ts'
import type { ComarkDocument } from './tree.ts'
import type { Target, Unit } from './walk.ts'
import { commentDraft } from '@diglot/code'
import { buildSegment, createReport, createSegmentEvent, normalise, parseSkeleton, resolvePolicy, resolveTranslation, setAtPath, tally, toSkeleton } from '@diglot/core'
import { toInline } from './inline.ts'
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
    const { segment } = await prepare(unit, options.file ?? '', segments.length, policy, spans)
    if (segment)
      segments.push(segment)
  }
  return { segments, spans }
}

export interface ApplyOptions extends ExtractOptions {
  /** Called for each segment in extraction order. Targets set props on the text block holding the segment, or on a `span` wrapping it. */
  onSegment?: (event: ApplySegmentEvent) => void
}

export interface Applied {
  doc: ComarkDocument
  report: ApplyReport
}

/**
 * Returns a copy of `doc` with translations applied. Translations are skeletons, keyed by
 * segment hash; each is validated against the current source segment, and its
 * placeholders are replaced by the current source nodes. Segments without a valid
 * translation keep their source text. Heading ids are kept.
 */
export async function apply(doc: ComarkDocument, translations: Translations, options: ApplyOptions = {}): Promise<Applied> {
  const policy = resolvePolicy(options.policy)
  const copy = structuredClone(doc)
  const report = createReport()
  const ranges: RangeEdit[] = []
  const code = new Map<ElementNode, Array<{ comment: CodeComment, text: string }>>()
  let index = 0
  for (const unit of walk(copy, policy)) {
    const { segment, refs } = await prepare(unit, options.file ?? '', index, policy)
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
      target.attrs[target.key] = resolution.text
    else if (target.type === 'frontmatter')
      setAtPath(copy.frontmatter, target.path, resolution.text)
    else if (target.type === 'code')
      code.set(target.element, [...(code.get(target.element) ?? []), { comment: target.comment, text: resolution.text }])
    else if (range)
      range.build = () => keepEdges(target.parent.slice(target.start, target.end), buildNodes(parseSkeleton(resolution.skeleton, segment.placeholders), refs))
  }
  for (const [element, edits] of code)
    replaceText(element, edits)
  for (const { target, build, wrap } of ranges.reverse()) {
    if (!build && !wrap)
      continue
    const nodes = build ? build() : target.parent.slice(target.start, target.end)
    target.parent.splice(target.start, target.end - target.start, ...(wrap ? keepEdges(nodes, [['span', wrap, ...trimEdges(nodes)] as ElementNode]) : nodes))
  }
  return { doc: copy, report }
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

async function prepare(unit: Unit, file: string, index: number, policy: Policy, spans?: InlineStats): Promise<{ segment?: Segment, refs: Array<LinkNode | AtomicNode> }> {
  let draft: SegmentDraft
  let refs: Array<LinkNode | AtomicNode> = []
  if (typeof unit.content === 'string') {
    draft = { kind: unit.kind, content: unit.content, context: unit.context, position: unit.position }
  }
  else if (Array.isArray(unit.content)) {
    const inline = await toInline(unit.content, unit.slicer, spans)
    refs = toSkeleton(normalise(inline)).nodes
    draft = { kind: unit.kind, content: inline, context: unit.context, position: unit.position }
  }
  else {
    draft = { ...commentDraft(unit.content, unit.language!, unit.context), position: unit.position }
  }
  return { segment: buildSegment(draft, { file, index, policy }), refs }
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
  const lead = typeof first === 'string' ? /^\s*/.exec(first)![0] : ''
  const trail = typeof last === 'string' ? /\s*$/.exec(last)![0] : ''
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
      push([data[0], structuredClone(data[1]), ...buildNodes(node.children, refs)])
    else
      push(structuredClone(data))
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
