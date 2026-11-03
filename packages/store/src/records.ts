import type { TranslationRecord } from '@diglot/core'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { normaliseRecord, parseRecord } from '@diglot/core'
import { dirname, join } from 'pathe'
import { recordPath, serialiseRecord } from './record-file.ts'

/** Reads one record, or `undefined` when it does not exist. */
export async function readRecord(root: string, locale: string, hash: string): Promise<TranslationRecord | undefined> {
  const content = await readFile(join(root, recordPath(locale, hash)), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  return content === undefined ? undefined : parseRecord(JSON.parse(content))
}

/** Validates and writes a record. Returns its path relative to the root. */
export async function writeRecord(root: string, locale: string, record: TranslationRecord): Promise<string> {
  const path = recordPath(locale, record.hash)
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, serialiseRecord(parseRecord(normaliseRecord(record))))
  return path
}

/** Reads every record of a locale, sorted by hash. Throws on malformed records. */
export async function readRecords(root: string, locale: string): Promise<TranslationRecord[]> {
  const base = join(root, locale, 'segments')
  const shards = await readdir(base).catch(() => [] as string[])
  const records: TranslationRecord[] = []
  for (const shard of shards.sort()) {
    if (!/^[0-9a-f]{2}$/.test(shard))
      continue
    for (const name of (await readdir(join(base, shard))).sort()) {
      if (!name.endsWith('.json'))
        continue
      const path = join(base, shard, name)
      const record = parseRecord(JSON.parse(await readFile(path, 'utf8')))
      if (`${record.hash}.json` !== name || !record.hash.startsWith(shard))
        throw new Error(`${path}: record hash ${record.hash} does not match its path`)
      records.push(record)
    }
  }
  return records
}

/** Reads every record of a locale into a map keyed by hash. */
export async function loadLocale(root: string, locale: string): Promise<Map<string, TranslationRecord>> {
  return new Map((await readRecords(root, locale)).map(r => [r.hash, r]))
}
