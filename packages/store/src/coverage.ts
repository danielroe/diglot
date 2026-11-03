import type { SegmentStatus, TranslationRecord } from '@diglot/core'
import type { Manifest, ManifestEntry } from './manifest-data.ts'
import { recordStatus } from '@diglot/core'
import { validationTarget } from './manifest-data.ts'

/** Words by what a reader sees. */
export interface Coverage {
  /** Words of the segments that have something to translate. */
  words: number
  byStatus: Partial<Record<SegmentStatus, number>>
}

/** Records by hash, as a map or a lookup function. */
export type RecordLookup = Pick<ReadonlyMap<string, TranslationRecord>, 'get'> | ((hash: string) => TranslationRecord | undefined)

export interface CoverageOptions {
  /** Whether a reader is shown a record. Records it returns `false` for count as `untranslated`. */
  visible?: (record: TranslationRecord) => boolean
}

/**
 * Words of a file's manifest entries by `recordStatus`, each record validated against its
 * entry: a record that fails validation counts as `rejected`, as readers see the source text.
 */
export function fileCoverage(entries: readonly ManifestEntry[], records: RecordLookup, options: CoverageOptions = {}): Coverage {
  const lookup = typeof records === 'function' ? records : (hash: string) => records.get(hash)
  const coverage: Coverage = { words: 0, byStatus: {} }
  for (const entry of entries) {
    if (!entry.words)
      continue
    const record = lookup(entry.hash)
    const status = recordStatus(record && (!options.visible || options.visible(record)) ? record : undefined, validationTarget(entry))
    coverage.words += entry.words
    coverage.byStatus[status] = (coverage.byStatus[status] ?? 0) + entry.words
  }
  return coverage
}

/** `fileCoverage` of every file of a manifest, by path. */
export function manifestCoverage(manifest: Pick<Manifest, 'files'>, records: RecordLookup, options: CoverageOptions = {}): Record<string, Coverage> {
  return Object.fromEntries(Object.entries(manifest.files).map(([file, entries]) => [file, fileCoverage(entries, records, options)]))
}
