import type { Segment } from './types.ts'
import type { ValidationIssue } from './validate.ts'
import { fromSkeleton } from './skeleton.ts'
import { validate } from './validate.ts'

/** Translated skeletons by segment hash, or a lookup function. */
export type Translations = ReadonlyMap<string, string> | ((segment: Segment) => string | undefined)

export type Resolution
  = | { status: 'missing' }
    | { status: 'rejected', errors: ValidationIssue[] }
    | {
      status: 'ok'
      /** The translated skeleton. */
      skeleton: string
      /** The translated skeleton with the current source's protected spans re-injected. */
      text: string
      warnings: ValidationIssue[]
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

/** Looks up and validates the translation for a segment, and re-injects its protected spans. */
export function resolveTranslation(segment: Segment, translations: Translations): Resolution {
  const skeleton = typeof translations === 'function' ? translations(segment) : translations.get(segment.hash)
  if (skeleton === undefined)
    return { status: 'missing' }
  const result = validate(skeleton, segment)
  if (!result.ok)
    return { status: 'rejected', errors: result.errors }
  return { status: 'ok', skeleton, text: fromSkeleton(skeleton, segment.placeholders), warnings: result.warnings }
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
