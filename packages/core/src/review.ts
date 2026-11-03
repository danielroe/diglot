import type { LocaleStyle } from './glossary.ts'
import type { TranslationRecord } from './record.ts'
import type { Segment } from './types.ts'
import type { ValidationIssue, ValidationTarget } from './validate.ts'
import { createRecord, normaliseRecord } from './record.ts'
import { maxTranslationLength, validate } from './validate.ts'

/**
 * Why a review transition was refused:
 * - `no-record`: there is no record to verify or reject
 * - `stale`: the record's text is not the `expected` text
 * - `invalid`: the text fails validation against the segment
 * - `unchanged`: the transition would not change the record
 * - `rejected`: the record is rejected; only an edit replaces a rejection
 */
export type ReviewRefusalCode = 'no-record' | 'stale' | 'invalid' | 'unchanged' | 'rejected'

export interface ReviewRefusal {
  ok: false
  code: ReviewRefusalCode
  message: string
  /** Validation errors, for `invalid`. */
  errors: ValidationIssue[]
}

export type ReviewTransition
  = | {
    ok: true
    /** The next record, normalised. */
    record: TranslationRecord
    /** Validation warnings of its text. */
    warnings: ValidationIssue[]
  }
  | ReviewRefusal

export interface ReviewOptions {
  /** GitHub login of the reviewer. */
  by: string
  /** ISO 8601 timestamp. Defaults to now. */
  at?: string
  /**
   * The text the reviewer saw. The transition is refused as `stale` unless it equals the current
   * `record.text`; `null` expects no record. Without it, the current text is not checked.
   */
  expected?: string | null
}

export interface EditOptions extends ReviewOptions {
  segment: Pick<Segment, 'hash' | 'skeleton' | 'salt'> & ValidationTarget
  /** The new translated skeleton. */
  text: string
  /** The locale's style, for `length` warnings. */
  style?: Pick<LocaleStyle, 'lengthRatio'>
  /** Longest accepted text, or `false` for no limit. Defaults to `maxTranslationLength` of the source skeleton. */
  maxLength?: number | false
}

export interface VerifyOptions extends ReviewOptions {
  /** Validates the record's text before verifying it. */
  segment?: ValidationTarget
  /** The locale's style, for `length` warnings. */
  style?: Pick<LocaleStyle, 'lengthRatio'>
}

function refuse(code: ReviewRefusalCode, message: string, errors: ValidationIssue[] = []): ReviewRefusal {
  return { ok: false, code, message, errors }
}

function stale(record: TranslationRecord | undefined, expected: string | null | undefined): boolean {
  return expected !== undefined && (record?.text ?? null) !== expected
}

/**
 * Replaces the text of a segment's record, or creates one, as a human edit. The machine
 * candidate and lineage of the current record are kept; its review stamps are dropped, so an
 * edit also replaces a rejection. A text that fails validation or is longer than `maxLength` is
 * refused as `invalid`, and an unchanged text as `unchanged` unless the record is rejected.
 */
export function editRecord(record: TranslationRecord | undefined, { segment, text, by, at = new Date().toISOString(), expected, style, maxLength = maxTranslationLength(segment.skeleton) }: EditOptions): ReviewTransition {
  if (stale(record, expected))
    return refuse('stale', 'the translation changed since it was loaded')
  const result = validate(text, segment, { style, ...(maxLength === false ? {} : { maxLength }) })
  if (!result.ok)
    return refuse('invalid', result.errors[0]!.message, result.errors)
  if (record?.text === text && record.review !== 'rejected')
    return refuse('unchanged', 'the translation is unchanged')
  return {
    ok: true,
    record: createRecord({ segment, text, origin: 'human', review: 'edited', derived: record?.derived ?? 'fresh', prev: record?.prev, mt: record?.mt, by, updatedAt: at }),
    warnings: result.warnings,
  }
}

/** Marks a record's current text as verified. Rejected, invalid and already verified records are refused. */
export function verifyRecord(record: TranslationRecord | undefined, { segment, by, at = new Date().toISOString(), expected, style }: VerifyOptions): ReviewTransition {
  if (!record)
    return refuse('no-record', 'there is no translation to verify')
  if (stale(record, expected))
    return refuse('stale', 'the translation changed since it was loaded')
  if (record.review === 'rejected')
    return refuse('rejected', 'the translation was rejected: edit it instead')
  const result = segment ? validate(record.text, segment, { style }) : { ok: true, errors: [], warnings: [] }
  if (!result.ok)
    return refuse('invalid', result.errors[0]!.message, result.errors)
  if (record.review === 'verified')
    return refuse('unchanged', 'the translation is already verified')
  return { ok: true, record: normaliseRecord({ ...record, review: 'verified', verifiedBy: { by, at }, updatedAt: at }), warnings: result.warnings }
}

/** Marks a record as rejected, so readers see the source text. Its text is kept and its verification dropped. */
export function rejectRecord(record: TranslationRecord | undefined, { by, at = new Date().toISOString(), expected }: ReviewOptions): ReviewTransition {
  if (!record)
    return refuse('no-record', 'there is no translation to reject')
  if (stale(record, expected))
    return refuse('stale', 'the translation changed since it was loaded')
  if (record.review === 'rejected')
    return refuse('unchanged', 'the translation is already rejected')
  return { ok: true, record: normaliseRecord({ ...record, review: 'rejected', rejectedBy: { by, at }, verifiedBy: undefined, updatedAt: at }), warnings: [] }
}
