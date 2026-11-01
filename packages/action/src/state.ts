import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'pathe'

/** Ancestors of each live hash, nearest first, from the segment diffs of earlier runs. */
export type Lineage = Record<string, string[]>

/** Segments whose machine translation was rejected, with the reasons, by hash. */
export type Rejections = Record<string, string[]>

const MAX_ANCESTORS = 5

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const content = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  return content === undefined ? fallback : JSON.parse(content) as T
}

async function writeJson(path: string, value: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(value).sort()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, keys.length ? `{\n${keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(value[k])}`).join(',\n')}\n}\n` : '{}\n')
}

const lineagePath = (stateDir: string) => join(stateDir, 'lineage.json')
const rejectionsPath = (stateDir: string, locale: string) => join(stateDir, 'rejected', `${locale}.json`)

export function readLineage(stateDir: string): Promise<Lineage> {
  return readJson(lineagePath(stateDir), {})
}

/** Records `after` as evolved from `before`, keeping only live hashes as keys. */
export function extendLineage(lineage: Lineage, pairs: Array<{ before: string, after: string }>, live: Set<string>): Lineage {
  const out: Lineage = {}
  for (const [hash, ancestors] of Object.entries(lineage)) {
    if (live.has(hash))
      out[hash] = ancestors
  }
  for (const { before, after } of pairs) {
    if (before !== after && live.has(after))
      out[after] = [before, ...(lineage[before] ?? []).filter(h => h !== after)].slice(0, MAX_ANCESTORS)
  }
  return out
}

export function writeLineage(stateDir: string, lineage: Lineage): Promise<void> {
  return writeJson(lineagePath(stateDir), lineage)
}

export function readRejections(stateDir: string, locale: string): Promise<Rejections> {
  return readJson(rejectionsPath(stateDir, locale), {})
}

/** Writes the rejections of a locale, removing the file when there are none. */
export async function writeRejections(stateDir: string, locale: string, rejections: Rejections): Promise<void> {
  if (Object.keys(rejections).length)
    await writeJson(rejectionsPath(stateDir, locale), rejections)
  else
    await rm(rejectionsPath(stateDir, locale), { force: true })
}
