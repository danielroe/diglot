import type { Segment } from './types.ts'
import type { ValidationTarget } from './validate.ts'
import { similarity } from './diff.ts'
import { validate } from './validate.ts'

/** How the current text was produced. */
export type Origin = 'mt' | 'tm' | 'human'
/** What a human has done to the current text. */
export type Review = 'none' | 'edited' | 'verified'
/** How the record relates to `prev`: `fresh` has none, `carry` copied its text, `update` was derived from it. */
export type Derived = 'fresh' | 'carry' | 'update'

export interface MachineTranslation {
  model: string
  promptVersion?: string
  /** The unedited machine output, kept to measure how much reviewers changed. */
  candidate: string
}

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
  /** ISO 8601 timestamp. */
  updatedAt: string
}

/** Key order used when serialising records. */
export const RECORD_KEYS: ReadonlyArray<keyof TranslationRecord> = ['hash', 'source', 'text', 'origin', 'review', 'derived', 'prev', 'salt', 'mt', 'by', 'verifiedBy', 'updatedAt']

const ORIGINS: readonly Origin[] = ['mt', 'tm', 'human']
const REVIEWS: readonly Review[] = ['none', 'edited', 'verified']
const DERIVED: readonly Derived[] = ['fresh', 'carry', 'update']

export class RecordError extends Error {
  override name: string = 'RecordError'
}

/** Checks the shape of an unknown value and returns it as a record. Throws `RecordError`. */
export function parseRecord(value: unknown): TranslationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RecordError('record must be an object')
  const input = value as Record<string, unknown>
  const fail = (message: string): never => {
    throw new RecordError(`${typeof input.hash === 'string' ? `${input.hash}: ` : ''}${message}`)
  }
  for (const key of Object.keys(input)) {
    if (!(RECORD_KEYS as readonly string[]).includes(key))
      fail(`unknown key "${key}"`)
  }
  const string = (key: string, optional = false) => {
    const v = input[key]
    if (v === undefined && optional)
      return
    if (typeof v !== 'string' || !v)
      fail(`"${key}" must be a non-empty string`)
  }
  string('hash')
  if (!/^[0-9a-f]{16}$/.test(input.hash as string))
    fail('"hash" must be 16 hex characters')
  string('source')
  string('text')
  string('updatedAt')
  string('prev', true)
  string('salt', true)
  string('by', true)
  if (!ORIGINS.includes(input.origin as Origin))
    fail(`"origin" must be one of ${ORIGINS.join(', ')}`)
  if (!REVIEWS.includes(input.review as Review))
    fail(`"review" must be one of ${REVIEWS.join(', ')}`)
  if (!DERIVED.includes(input.derived as Derived))
    fail(`"derived" must be one of ${DERIVED.join(', ')}`)
  if (input.derived !== 'fresh' && input.prev === undefined)
    fail(`"prev" is required when "derived" is ${input.derived}`)
  if (input.mt !== undefined) {
    const mt = input.mt as Record<string, unknown>
    if (!mt || typeof mt !== 'object' || typeof mt.model !== 'string' || typeof mt.candidate !== 'string' || (mt.promptVersion !== undefined && typeof mt.promptVersion !== 'string'))
      fail('"mt" must have string "model" and "candidate"')
  }
  if (input.verifiedBy !== undefined) {
    const v = input.verifiedBy as Record<string, unknown>
    if (!v || typeof v !== 'object' || typeof v.by !== 'string' || typeof v.at !== 'string')
      fail('"verifiedBy" must have string "by" and "at"')
  }
  if (input.review === 'verified' && input.verifiedBy === undefined)
    fail('"verifiedBy" is required when "review" is verified')
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
      : key === 'verifiedBy' ? { by: record.verifiedBy!.by, at: record.verifiedBy!.at } : value
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
 * Derives the reader-facing status of a segment from its record. With a `segment`, the
 * record's text is validated against it and a failure yields `rejected`.
 */
export function recordStatus(record: TranslationRecord | undefined, segment?: ValidationTarget): SegmentStatus {
  if (!record)
    return 'untranslated'
  if (segment && !validate(record.text, segment).ok)
    return 'rejected'
  if (record.review === 'verified')
    return 'verified'
  if (record.review === 'edited')
    return 'edited'
  if (record.origin === 'human')
    return 'edited'
  return record.derived === 'fresh' ? 'machine' : 'pending-review'
}

/** Share of the machine candidate that reviewers changed, 0 to 1. `undefined` without a candidate. */
export function editRatio(record: Pick<TranslationRecord, 'text' | 'mt'>): number | undefined {
  return record.mt ? 1 - similarity(record.mt.candidate, record.text) : undefined
}
