import type { SegmentStatus, TranslationRecord } from './record.ts'
import type { Segment } from './types.ts'
import type { ValidationIssue } from './validate.ts'
import { recordStatus } from './record.ts'
import { encodeInvisibles, fromSkeleton, isPlaceholderOnly } from './skeleton.ts'
import { validate } from './validate.ts'

/** Translated skeletons or translation records by segment hash, or a lookup function. */
export type Translations
  = | ReadonlyMap<string, string | TranslationRecord>
    | ((segment: Segment) => string | TranslationRecord | undefined)

export type Resolution
  = | { status: 'missing' }
    | { status: 'rejected', errors: ValidationIssue[], record?: TranslationRecord }
    | {
      status: 'ok'
      /** The translated skeleton. */
      skeleton: string
      /** The translated skeleton with the current source's protected spans re-injected. */
      text: string
      warnings: ValidationIssue[]
      record?: TranslationRecord
    }

export interface RejectedTranslation {
  hash: string
  file: string
  index: number
  errors: ValidationIssue[]
}

/** Outcome of applying translations to one document. Segments that are not applied keep their source text. */
export interface ApplyReport {
  applied: number
  missing: number
  rejected: RejectedTranslation[]
}

/**
 * What `apply` did with a segment. `translated` segments show their translation; `missing`
 * (no translation) and `rejected` (a reviewer rejected the translation, or it failed validation
 * or could not be placed) keep their source text. `skipped` segments have no translation and
 * nothing to translate.
 */
export type ApplyOutcome = 'translated' | 'missing' | 'rejected' | 'skipped'

/** The output node holding a segment's text. */
export interface SegmentTarget {
  /** Sets an attribute on the output node. Call it from `onSegment`. */
  setAttribute: (name: string, value: string) => void
}

/** Passed to `onSegment` for each segment, in extraction order. */
export interface ApplySegmentEvent {
  segment: Segment
  outcome: ApplyOutcome
  /** Why a `rejected` translation was not applied. Empty otherwise. */
  errors: ValidationIssue[]
  /** The record the lookup returned, if it returned one. */
  record?: TranslationRecord
  /**
   * What a reader sees: `recordStatus(record)` for translated segments, `rejected` or
   * `untranslated` for segments that keep their source text. `undefined` when a segment is
   * translated from a bare skeleton rather than a record.
   */
  status?: SegmentStatus
  /** `null` for segments without an annotatable node of their own: frontmatter, props, image alts, code labels and code comments. */
  target: SegmentTarget | null
}

/** Looks up and validates the translation for a segment, and re-injects its protected spans. */
export function resolveTranslation(segment: Segment, translations: Translations): Resolution {
  const found = typeof translations === 'function' ? translations(segment) : translations.get(segment.hash)
  if (found === undefined)
    return { status: 'missing' }
  const record = typeof found === 'string' ? undefined : { record: found }
  if (typeof found !== 'string' && found.review === 'rejected')
    return { status: 'rejected', errors: [{ code: 'rejected', message: `rejected by ${found.rejectedBy?.by ?? 'a reviewer'}` }], record: found }
  const text = typeof found === 'string' ? found : found.text
  const skeleton = segment.format === 'plain' ? text : encodeInvisibles(text)
  const result = validate(skeleton, segment)
  if (!result.ok)
    return { status: 'rejected', errors: result.errors, ...record }
  return { status: 'ok', skeleton, text: fromSkeleton(skeleton, segment.placeholders), warnings: result.warnings, ...record }
}

/** Describes how a segment was resolved, for `onSegment`. */
export function createSegmentEvent(segment: Segment, resolution: Resolution, target: SegmentTarget | null): ApplySegmentEvent {
  const record = resolution.status === 'missing' ? undefined : resolution.record
  const base = { segment, target, ...(record ? { record } : {}) }
  if (resolution.status === 'ok')
    return { ...base, outcome: 'translated', errors: [], ...(record ? { status: recordStatus(record) } : {}) }
  if (resolution.status === 'rejected')
    return { ...base, outcome: 'rejected', errors: resolution.errors, status: 'rejected' }
  return { ...base, outcome: isPlaceholderOnly(segment.skeleton) ? 'skipped' : 'missing', errors: [], status: 'untranslated' }
}

/** Sums the words of segments by `status`. Segments without a status are not counted. */
export function wordsByStatus(events: Iterable<ApplySegmentEvent>): Partial<Record<SegmentStatus, number>> {
  const words: Partial<Record<SegmentStatus, number>> = {}
  for (const { segment, status } of events) {
    if (status)
      words[status] = (words[status] ?? 0) + segment.words
  }
  return words
}

/** An empty report. */
export function createReport(): ApplyReport {
  return { applied: 0, missing: 0, rejected: [] }
}

/** Counts a resolution in `report`. */
export function tally(report: ApplyReport, segment: Segment, resolution: Resolution): void {
  if (resolution.status === 'ok')
    report.applied++
  else if (resolution.status === 'missing')
    report.missing++
  else
    report.rejected.push({ hash: segment.hash, file: segment.context.file, index: segment.context.index, errors: resolution.errors })
}
