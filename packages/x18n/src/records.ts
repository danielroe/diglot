import type { TranslationRecord } from '@diglot/core'
import type { ManifestEntry } from '@diglot/store'
import type { Resource } from '@x18n/core'
import { parseRecord } from '@diglot/core'
import { MANIFEST_FORMAT, manifestEntries, RECORD_FORMAT } from './format.ts'

export interface RecordIndex {
  records: (resources: readonly Resource[], text: (path: string) => string | undefined) => Map<string, Map<string, TranslationRecord>>
  entries: (resources: readonly Resource[], text: (path: string) => string | undefined) => Map<string, ManifestEntry[]>
}

export function createRecordIndex(): RecordIndex {
  const records = new Map<string, { text: string, record: TranslationRecord | undefined }>()
  const manifests = new Map<string, { text: string, entries: Map<string, ManifestEntry[]> }>()
  return {
    records(resources, text) {
      const out = new Map<string, Map<string, TranslationRecord>>()
      for (const resource of resources) {
        if (resource.format !== RECORD_FORMAT)
          continue
        const content = text(resource.path)
        if (content === undefined)
          continue
        let cached = records.get(resource.path)
        if (cached?.text !== content) {
          let record: TranslationRecord | undefined
          try {
            record = parseRecord(JSON.parse(content))
          }
          catch {}
          cached = { text: content, record }
          records.set(resource.path, cached)
        }
        if (!cached.record)
          continue
        const byHash = out.get(resource.locale) ?? new Map<string, TranslationRecord>()
        out.set(resource.locale, byHash)
        byHash.set(cached.record.hash, cached.record)
      }
      return out
    },
    entries(resources, text) {
      const out = new Map<string, ManifestEntry[]>()
      for (const resource of resources) {
        if (resource.format !== MANIFEST_FORMAT)
          continue
        const content = text(resource.path)
        if (content === undefined)
          continue
        let cached = manifests.get(resource.path)
        if (cached?.text !== content) {
          cached = { text: content, entries: manifestEntries(content) }
          manifests.set(resource.path, cached)
        }
        for (const [hash, list] of cached.entries) {
          const merged = out.get(hash) ?? []
          for (const entry of list) {
            if (!merged.some(e => e.kind === entry.kind && e.format === entry.format))
              merged.push(entry)
          }
          out.set(hash, merged)
        }
      }
      return out
    },
  }
}
