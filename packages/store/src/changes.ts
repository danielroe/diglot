import type { TranslationRecord } from '@diglot/core'

/** Records by hash: a map, or anything with its `get` and `keys`. */
export type RecordSet = Pick<ReadonlyMap<string, TranslationRecord | undefined>, 'get' | 'keys'>

const READER_FIELDS: ReadonlyArray<keyof TranslationRecord> = ['text', 'review', 'origin', 'derived']

function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))
}

/**
 * Hashes whose record was added, removed or changed between two record sets of one locale.
 * Records are compared on `fields`, by default those that change what a reader sees: `text`,
 * `review`, `origin` and `derived`.
 */
export function changedRecords(before: RecordSet, after: RecordSet, fields: ReadonlyArray<keyof TranslationRecord> = READER_FIELDS): Set<string> {
  const changed = new Set<string>()
  for (const hash of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(hash)
    const b = after.get(hash)
    if (!a !== !b || (a && b && fields.some(field => !same(a[field], b[field]))))
      changed.add(hash)
  }
  return changed
}
