import type { TranslationRecord } from '@diglot/core'
import { parseRecord } from '@diglot/core'

/** The consumer artifact for one locale, `dist/<locale>.json`. */
export interface LocaleBundle {
  version: 1
  locale: string
  records: Record<string, TranslationRecord>
}

/** Parses a locale bundle into a map keyed by hash, validating every record. */
export function parseBundle(content: string | LocaleBundle): Map<string, TranslationRecord> {
  const bundle = typeof content === 'string' ? JSON.parse(content) as LocaleBundle : content
  if (bundle.version !== 1 || typeof bundle.records !== 'object')
    throw new Error('unsupported locale bundle')
  return new Map(Object.entries(bundle.records).map(([hash, record]) => {
    const parsed = parseRecord(record)
    if (parsed.hash !== hash)
      throw new Error(`bundle key ${hash} does not match record ${parsed.hash}`)
    return [hash, parsed]
  }))
}
