import type { TranslationRecord } from '@diglot/core'
import type { HistoryProvider, MessageChange, MessageLeaf } from '@x18n/core'
import { parseRecord } from '@diglot/core'
import { RECORD_FORMAT } from './format.ts'

interface Stale {
  /** When the source changed: the `updatedAt` of the carried record. */
  at: number
  previous?: TranslationRecord
}

/**
 * Reports when each translation last changed from record metadata. A record carried or
 * updated from a predecessor and not yet reviewed is stale: its source changed at the
 * record's `updatedAt`, after the predecessor's translation.
 */
export function recordHistory(sourceLocale: () => string): HistoryProvider {
  return {
    id: 'diglot',
    async load(ctx) {
      const byLocale = new Map<string, Map<string, TranslationRecord>>()
      for (const resource of ctx.resources) {
        if (resource.format !== RECORD_FORMAT)
          continue
        const text = await ctx.host.readFile(resource.path)
        if (text === undefined)
          continue
        try {
          const record = parseRecord(JSON.parse(text))
          const records = byLocale.get(resource.locale) ?? new Map<string, TranslationRecord>()
          byLocale.set(resource.locale, records)
          records.set(record.hash, record)
        }
        catch {}
      }
      const source = sourceLocale()
      const changes = new Map<string, Map<string, MessageChange>>()
      const stale = new Map<string, Stale>()
      const set = (hash: string, locale: string, change: MessageChange) => {
        const entry = changes.get(hash) ?? new Map<string, MessageChange>()
        changes.set(hash, entry)
        entry.set(locale, change)
      }
      for (const [locale, records] of byLocale) {
        for (const record of records.values()) {
          const previous = record.prev ? records.get(record.prev) : undefined
          const author = record.verifiedBy?.by ?? record.by
          const updatedAt = Date.parse(record.updatedAt)
          if (record.review === 'none' && record.derived !== 'fresh') {
            const before = previous ? Math.min(Date.parse(previous.updatedAt), updatedAt - 1) : updatedAt - 1
            set(record.hash, locale, { updatedAt: before, revision: previous?.hash, author: previous?.verifiedBy?.by ?? previous?.by, value: record.text })
            set(record.hash, source, { updatedAt, revision: record.prev, value: record.source })
            stale.set(`${record.hash}\0${locale}`, { at: updatedAt, ...(previous ? { previous } : {}) })
          }
          else {
            set(record.hash, locale, { updatedAt, author, value: record.text })
          }
        }
      }
      return {
        changes,
        valueAt(key, locale, at): MessageLeaf | undefined {
          for (const [id, entry] of stale) {
            if (!entry.previous || !id.startsWith(`${key}\0`) || at >= entry.at)
              continue
            if (locale === source)
              return entry.previous.source
            if (id === `${key}\0${locale}`)
              return entry.previous.text
          }
          return undefined
        },
      }
    },
  }
}
