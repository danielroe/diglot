import type { TranslationRecord } from '@diglot/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { normaliseRecord, parseRecord } from '@diglot/core'
import { join } from 'pathe'
import { readRecords } from './records.ts'

/** The consumer artifact for one locale, `dist/<locale>.json`. */
export interface LocaleBundle {
  version: 1
  locale: string
  records: Record<string, TranslationRecord>
}

export interface BuildOptions {
  locales: string[]
  /** Output directory relative to `root`. Defaults to `dist`. */
  outDir?: string
  /** Only include these hashes, typically the live hashes of all manifests. */
  only?: Set<string>
}

export interface BuildResult {
  locale: string
  path: string
  records: number
  /** Records in the bundle that a reviewer rejected. */
  rejected: number
  /** Records left out because their hash is not live. */
  skipped: number
}

/** Builds `dist/<locale>.json` for each locale from the per-record files. */
export async function build(root: string, options: BuildOptions): Promise<BuildResult[]> {
  const outDir = options.outDir ?? 'dist'
  await mkdir(join(root, outDir), { recursive: true })
  const results: BuildResult[] = []
  for (const locale of options.locales) {
    const all = await readRecords(root, locale)
    const kept = options.only ? all.filter(r => options.only!.has(r.hash)) : all
    const bundle: LocaleBundle = { version: 1, locale, records: Object.fromEntries(kept.map(r => [r.hash, normaliseRecord(r)])) }
    const path = join(outDir, `${locale}.json`)
    await writeFile(join(root, path), `${JSON.stringify(bundle)}\n`)
    results.push({ locale, path, records: kept.length, rejected: kept.filter(r => r.review === 'rejected').length, skipped: all.length - kept.length })
  }
  return results
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
