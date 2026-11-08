import type { Segment } from './types.ts'
import type { ValidationTarget } from './validate.ts'
import { similarity } from './diff.ts'
import { encodeInvisibles } from './skeleton.ts'
import { validate } from './validate.ts'

/** How the current text was produced. */
export type Origin = 'mt' | 'tm' | 'human'
/** What a human has done to the current text. A `rejected` text is not shown to readers. */
export type Review = 'none' | 'edited' | 'verified' | 'rejected'
/** How the record relates to `prev`: `fresh` has none, `carry` copied its text (same skeleton, different hash), `update` was derived from it. */
export type Derived = 'fresh' | 'carry' | 'update'

export interface MachineTranslation {
  model: string
  promptVersion?: string
  /** The unedited machine output, kept to measure how much reviewers changed. */
  candidate: string
}

/** Who reviewed the current text, and when. */
export interface Verification {
  /** GitHub login. */
  by: string
  /** ISO 8601 timestamp. */
  at: string
}

/** One translation of one source segment into one locale. */
export interface TranslationRecord {
  /** Identity of the source skeleton. */
  hash: string
  /** The source skeleton, so the record is reviewable on its own. */
  source: string
  /** The translated skeleton. */
  text: string
  origin: Origin
  review: Review
  derived: Derived
  /** Hash of the record this one evolved from. */
  prev?: string
  /** Context salt of the source segment, when its hash is salted. */
  salt?: string
  mt?: MachineTranslation
  /** GitHub login of the last editor. */
  by?: string
  verifiedBy?: Verification
  /** Required when `review` is `rejected`, and only then. */
  rejectedBy?: Verification
  /** ISO 8601 timestamp. */
  updatedAt: string
}

/** Key order used when serialising records. */
export const RECORD_KEYS: ReadonlyArray<keyof TranslationRecord> = ['hash', 'source', 'text', 'origin', 'review', 'derived', 'prev', 'salt', 'mt', 'by', 'verifiedBy', 'rejectedBy', 'updatedAt']

const ORIGINS: readonly Origin[] = ['mt', 'tm', 'human']
const REVIEWS: readonly Review[] = ['none', 'edited', 'verified', 'rejected']
const DERIVED: readonly Derived[] = ['fresh', 'carry', 'update']

export class RecordError extends Error {
  override name: string = 'RecordError'
}

const RECORD_KEY_SET: ReadonlySet<string> = new Set(RECORD_KEYS)
const HASH_RE = /^[0-9a-f]{16}$/

function fail(input: Record<string, unknown>, message: string): never {
  throw new RecordError(`${typeof input.hash === 'string' ? `${input.hash}: ` : ''}${message}`)
}

function checkString(input: Record<string, unknown>, key: string, optional = false): void {
  const v = input[key]
  if (v === undefined && optional)
    return
  if (typeof v !== 'string' || !v)
    fail(input, `"${key}" must be a non-empty string`)
}

/** Checks the shape of an unknown value and returns it as a record. Throws `RecordError`. */
export function parseRecord(value: unknown): TranslationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RecordError('record must be an object')
  const input = value as Record<string, unknown>
  for (const key in input) {
    if (Object.hasOwn(input, key) && !RECORD_KEY_SET.has(key))
      fail(input, `unknown key "${key}"`)
  }
  checkString(input, 'hash')
  if (!HASH_RE.test(input.hash as string))
    fail(input, '"hash" must be 16 hex characters')
  checkString(input, 'source')
  checkString(input, 'text')
  checkString(input, 'updatedAt')
  checkString(input, 'prev', true)
  checkString(input, 'salt', true)
  checkString(input, 'by', true)
  if (!ORIGINS.includes(input.origin as Origin))
    fail(input, `"origin" must be one of ${ORIGINS.join(', ')}`)
  if (!REVIEWS.includes(input.review as Review))
    fail(input, `"review" must be one of ${REVIEWS.join(', ')}`)
  if (!DERIVED.includes(input.derived as Derived))
    fail(input, `"derived" must be one of ${DERIVED.join(', ')}`)
  if (input.derived !== 'fresh' && input.prev === undefined)
    fail(input, `"prev" is required when "derived" is ${input.derived}`)
  if (input.mt !== undefined) {
    const mt = input.mt as Record<string, unknown>
    if (!mt || typeof mt !== 'object' || typeof mt.model !== 'string' || typeof mt.candidate !== 'string' || (mt.promptVersion !== undefined && typeof mt.promptVersion !== 'string'))
      fail(input, '"mt" must have string "model" and "candidate"')
  }
  for (const key of ['verifiedBy', 'rejectedBy']) {
    const v = input[key] as Record<string, unknown> | undefined
    if (v !== undefined && (!v || typeof v !== 'object' || typeof v.by !== 'string' || typeof v.at !== 'string'))
      fail(input, `"${key}" must have string "by" and "at"`)
  }
  if (input.review === 'verified' && input.verifiedBy === undefined)
    fail(input, '"verifiedBy" is required when "review" is verified')
  if ((input.review === 'rejected') !== (input.rejectedBy !== undefined))
    fail(input, input.review === 'rejected' ? '"rejectedBy" is required when "review" is rejected' : '"rejectedBy" is only allowed when "review" is rejected')
  return input as unknown as TranslationRecord
}

/** Returns a copy with keys in `RECORD_KEYS` order and undefined fields dropped. */
export function normaliseRecord(record: TranslationRecord): TranslationRecord {
  const out: Record<string, unknown> = {}
  for (const key of RECORD_KEYS) {
    const value = record[key]
    if (value === undefined)
      continue
    out[key] = key === 'mt' && typeof value === 'object'
      ? Object.fromEntries((['model', 'promptVersion', 'candidate'] as const).flatMap(k => record.mt![k] === undefined ? [] : [[k, record.mt![k]]]))
      : (key === 'verifiedBy' || key === 'rejectedBy') && typeof value === 'object' ? { by: (value as Verification).by, at: (value as Verification).at } : value
  }
  return out as unknown as TranslationRecord
}

export interface CreateRecordInput extends Partial<Omit<TranslationRecord, 'hash' | 'source' | 'text' | 'salt'>> {
  segment: Pick<Segment, 'hash' | 'skeleton' | 'salt'>
  text: string
  origin: Origin
}

/** Creates a record for a segment. `review` defaults to `none`, `derived` to `fresh` (or `update` when `prev` is set). */
export function createRecord({ segment, text, ...fields }: CreateRecordInput): TranslationRecord {
  return normaliseRecord({
    review: 'none',
    derived: fields.prev ? 'update' : 'fresh',
    updatedAt: new Date().toISOString(),
    ...fields,
    hash: segment.hash,
    source: segment.skeleton,
    text,
    ...(segment.salt ? { salt: segment.salt } : {}),
  })
}

/** What a reader sees for a segment. */
export type SegmentStatus = 'untranslated' | 'machine' | 'pending-review' | 'edited' | 'verified' | 'rejected'

/**
 * Derives the reader-facing status of a segment from its record. A record whose `review` is
 * `rejected` is `rejected`. With a `segment`, the record's text is validated against it and a
 * failure also yields `rejected`.
 */
export function recordStatus(record: TranslationRecord | undefined, segment?: ValidationTarget): SegmentStatus {
  if (!record)
    return 'untranslated'
  if (record.review === 'rejected')
    return 'rejected'
  if (segment && !validate(segment.format === 'plain' ? record.text : encodeInvisibles(record.text), segment).ok)
    return 'rejected'
  if (record.review === 'verified')
    return 'verified'
  if (record.review === 'edited')
    return 'edited'
  if (record.derived !== 'fresh')
    return 'pending-review'
  return record.origin === 'human' ? 'edited' : 'machine'
}

/** Share of the machine candidate that reviewers changed, 0 to 1. `undefined` without a candidate. */
export function editRatio(record: Pick<TranslationRecord, 'text' | 'mt'>): number | undefined {
  return record.mt ? 1 - similarity(record.mt.candidate, record.text) : undefined
}
