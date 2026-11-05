import type { ApplyReport, InlineNode, Policy, Segment, SegmentDraft, Translations } from '@diglot/core'
import { buildSegment, createReport, resolvePolicy, resolveTranslation, tally } from '@diglot/core'
import { isScalar, parseDocument } from 'yaml'

export interface NavigationOptions {
  file?: string
  policy?: Partial<Policy>
}

export interface LabelOptions {
  /**
   * `navigation` for a `.navigation.yml` value such as a `title` or `titleTemplate`, where `%s`
   * is a placeholder, or `frontmatter` for a frontmatter value such as a page `title`. Defaults
   * to `navigation`.
   */
  kind?: 'navigation' | 'frontmatter'
  /** File the label was extracted from. */
  file?: string
  /** Key or frontmatter path of the label, such as `title`, `titleTemplate` or `navigation.title`. */
  detail?: string
  /** Only `salt` is read. */
  policy?: Pick<Policy, 'salt'>
  /** Ordinal of the segment within its file. Defaults to `0`. */
  index?: number
}

interface NavigationUnit {
  draft: SegmentDraft
  range: [number, number]
}

function labelDraft(value: string, kind: 'navigation' | 'frontmatter', detail?: string): SegmentDraft {
  return {
    kind,
    format: 'plain',
    content: kind === 'navigation' ? templateInline(value) : value,
    context: { headingTrail: [], containers: [], ...(detail ? { detail } : {}) },
    position: { startLine: 1, endLine: 1, precision: 'file' },
  }
}

/**
 * The segment of a plain label, hashed as `extractNavigation` (or, with `kind: 'frontmatter'`,
 * `extract`) hashes it. Returns `undefined` for an empty label.
 */
export function labelSegment(value: string, options: LabelOptions = {}): Segment | undefined {
  return buildSegment(labelDraft(value, options.kind ?? 'navigation', options.detail), { file: options.file ?? '', index: options.index ?? 0, policy: options.policy })
}

/** A label in the language of `translations`, or `value` itself without a valid translation. */
export function translateLabel(value: string, translations: Translations, options: LabelOptions = {}): string {
  const segment = labelSegment(value, options)
  if (!segment)
    return value
  const resolution = resolveTranslation(segment, translations)
  return resolution.status === 'ok' ? resolution.text : value
}

function units(source: string, policy: Policy): NavigationUnit[] {
  const doc = parseDocument(source)
  const out: NavigationUnit[] = []
  for (const key of policy.navigation) {
    const node = doc.get(key, true)
    if (!isScalar(node) || typeof node.value !== 'string' || !node.value.trim() || !node.range)
      continue
    const [start] = node.range
    // Block scalars (`>-`, `|`) end after their trailing line break, which must survive the edit.
    let end = node.range[1]
    while (end > start && (source[end - 1] === '\n' || source[end - 1] === '\r'))
      end--
    out.push({ draft: labelDraft(node.value, 'navigation', key), range: [start, end] })
  }
  return out
}

/** Extracts the prose keys of a `.navigation.yml` file. `%s` in templates becomes a placeholder. */
export function extractNavigation(source: string, options: NavigationOptions = {}): Segment[] {
  const policy = resolvePolicy(options.policy)
  const segments: Segment[] = []
  for (const unit of units(source, policy)) {
    const segment = buildSegment(unit.draft, { file: options.file ?? '', index: segments.length, policy })
    if (segment)
      segments.push(segment)
  }
  return segments
}

/** Applies translations to a `.navigation.yml` file, replacing only the translated values. */
export function applyNavigation(source: string, translations: Translations, options: NavigationOptions = {}): { source: string, report: ApplyReport } {
  const policy = resolvePolicy(options.policy)
  const report = createReport()
  const edits: Array<[number, number, string]> = []
  let index = 0
  for (const unit of units(source, policy)) {
    const segment = buildSegment(unit.draft, { file: options.file ?? '', index, policy })
    if (!segment)
      continue
    index++
    const resolution = resolveTranslation(segment, translations)
    tally(report, segment, resolution)
    if (resolution.status === 'ok')
      edits.push([...unit.range, JSON.stringify(resolution.text)])
  }
  let out = source
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0]))
    out = out.slice(0, start) + text + out.slice(end)
  return { source: out, report }
}

function templateInline(value: string): InlineNode[] {
  return value.split(/(%s)/).filter(Boolean).map(part => part === '%s'
    ? { type: 'atomic', kind: 'other', source: '%s' }
    : { type: 'text', value: part })
}
