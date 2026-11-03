import type { TranslationRecord } from '@diglot/core'
import { normaliseRecord, parseRecord } from '@diglot/core'

const RECORD_PATH_RE = /^([^/]+)\/segments\/([0-9a-f]{2})\/([0-9a-f]{16})\.json$/

/** Path of a record relative to the store root: `<locale>/segments/<hh>/<hash>.json`. */
export function recordPath(locale: string, hash: string): string {
  return `${locale}/segments/${hash.slice(0, 2)}/${hash}.json`
}

/** The locale and hash of a record path relative to the store root, or `undefined` for any other path. */
export function parseRecordPath(path: string): { locale: string, hash: string } | undefined {
  const match = RECORD_PATH_RE.exec(path)
  if (match && match[3]!.startsWith(match[2]!))
    return { locale: match[1]!, hash: match[3]! }
}

/** Serialises a record deterministically: fixed key order, two-space indent, trailing newline. */
export function serialiseRecord(record: TranslationRecord): string {
  return `${JSON.stringify(normaliseRecord(record), null, 2)}\n`
}

/**
 * Parses the text of a record file. Returns `undefined` when there is no text, it is not a
 * valid record, or its `hash` is not `hash`.
 */
export function parseRecordFile(text: string | undefined, hash?: string): TranslationRecord | undefined {
  if (text === undefined)
    return
  let record: TranslationRecord
  try {
    record = parseRecord(JSON.parse(text))
  }
  catch {
    return
  }
  return hash === undefined || record.hash === hash ? record : undefined
}
