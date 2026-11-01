import type { DiffableSegment, PlaceholderType, Segment, ValidationTarget } from '@diglot/core'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'pathe'

/** A source segment as recorded in a manifest. */
export interface ManifestEntry extends DiffableSegment {
  words: number
  /** Placeholder types by id. Whether a placeholder is paired follows from the skeleton. */
  placeholders?: PlaceholderType[]
  salt?: string
}

/** The segments of every file of one source at one revision, in document order. */
export interface Manifest {
  version: 1
  source: string
  ref?: string
  sha?: string
  files: Record<string, ManifestEntry[]>
}

/** Builds a manifest from extracted segments. */
export function createManifest(source: string, files: Record<string, Segment[]>, revision: { ref?: string, sha?: string } = {}): Manifest {
  return {
    version: 1,
    source,
    ...(revision.ref ? { ref: revision.ref } : {}),
    ...(revision.sha ? { sha: revision.sha } : {}),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([path, segments]) => [path, segments.map(toEntry)])),
  }
}

function toEntry(segment: Segment | ManifestEntry): ManifestEntry {
  const placeholders = segment.placeholders?.map(p => typeof p === 'string' ? p : p.type) ?? []
  return {
    hash: segment.hash,
    kind: segment.kind,
    format: segment.format,
    words: segment.words,
    skeleton: segment.skeleton,
    ...(placeholders.length ? { placeholders } : {}),
    ...(segment.salt ? { salt: segment.salt } : {}),
  }
}

/** Path of a source's manifest inside the state directory. */
export function manifestPath(stateDir: string, source: string): string {
  return join(stateDir, 'manifest', `${source}.json`)
}

/** Serialises a manifest with one entry per line, so diffs show changed segments. */
export function serialiseManifest(manifest: Manifest): string {
  const { files, ...head } = manifest
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  const paths = Object.keys(files).sort()
  const body = paths.map((path, i) => {
    const entries = files[path]!.map(toEntry).map(e => `      ${JSON.stringify(e)}`).join(',\n')
    return `    ${JSON.stringify(path)}: [${entries ? `\n${entries}\n    ` : ''}]${i < paths.length - 1 ? ',' : ''}`
  })
  return `{\n${lines.join('\n')}\n  "files": {${body.length ? `\n${body.join('\n')}\n  ` : ''}}\n}\n`
}

export async function readManifest(stateDir: string, source: string): Promise<Manifest | undefined> {
  const content = await readFile(manifestPath(stateDir, source), 'utf8').catch(() => undefined)
  if (content === undefined)
    return
  const manifest = JSON.parse(content) as Manifest
  if (manifest.version !== 1 || typeof manifest.files !== 'object')
    throw new Error(`${manifestPath(stateDir, source)}: unsupported manifest`)
  return manifest
}

export async function writeManifest(stateDir: string, manifest: Manifest): Promise<string> {
  const path = manifestPath(stateDir, manifest.source)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serialiseManifest(manifest))
  return path
}

/** Reads every manifest in the state directory. */
export async function readManifests(stateDir: string): Promise<Manifest[]> {
  const names = await readdir(join(stateDir, 'manifest')).catch(() => [] as string[])
  const manifests: Manifest[] = []
  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    const manifest = await readManifest(stateDir, name.slice(0, -5))
    if (manifest)
      manifests.push(manifest)
  }
  return manifests
}

/** What `validate` needs to check a translation of a manifest entry. */
export function validationTarget(entry: ManifestEntry): ValidationTarget {
  const paired = new Set([...entry.skeleton.matchAll(/(?<!\\)\{\/(\d+)\}/g)].map(m => Number(m[1])))
  return {
    kind: entry.kind,
    format: entry.format,
    skeleton: entry.skeleton,
    placeholders: (entry.placeholders ?? []).map((type, id) => ({ id, type, source: '', ...(paired.has(id) ? { close: '' } : {}) })),
  }
}

/** Hashes used by any file of the given manifests. */
export function liveHashes(manifests: Manifest[]): Set<string> {
  return new Set(manifests.flatMap(m => Object.values(m.files).flat().map(e => e.hash)))
}
