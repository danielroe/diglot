import type { DiffableSegment, PlaceholderType, Segment, ValidationTarget } from '@diglot/core'

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
  /** `policyFingerprint` of the policy the segments were extracted under. */
  policy?: string
  files: Record<string, ManifestEntry[]>
}

/** Builds a manifest from extracted segments. */
export function createManifest(source: string, files: Record<string, Segment[]>, revision: { ref?: string, sha?: string, policy?: string } = {}): Manifest {
  return {
    version: 1,
    source,
    ...(revision.ref ? { ref: revision.ref } : {}),
    ...(revision.sha ? { sha: revision.sha } : {}),
    ...(revision.policy ? { policy: revision.policy } : {}),
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
