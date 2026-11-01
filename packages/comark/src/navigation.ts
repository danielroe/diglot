import type { ApplyReport, InlineNode, Policy, Segment, SegmentDraft, Translations } from '@diglot/core'
import { buildSegment, createReport, resolvePolicy, resolveTranslation, tally } from '@diglot/core'
import { isScalar, parseDocument } from 'yaml'

export interface NavigationOptions {
  file?: string
  policy?: Partial<Policy>
}

interface NavigationUnit {
  draft: SegmentDraft
  range: [number, number]
}

function units(source: string, policy: Policy): NavigationUnit[] {
  const doc = parseDocument(source)
  const out: NavigationUnit[] = []
  for (const key of policy.navigation) {
    const node = doc.get(key, true)
    if (!isScalar(node) || typeof node.value !== 'string' || !node.value.trim() || !node.range)
      continue
    out.push({
      draft: {
        kind: 'navigation',
        format: 'plain',
        content: templateInline(node.value),
        context: { headingTrail: [], containers: [], detail: key },
        position: { startLine: 1, endLine: 1, precision: 'file' },
      },
      range: [node.range[0], node.range[1]],
    })
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
