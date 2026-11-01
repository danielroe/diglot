import type { Extracted } from './adapters/comark.ts'
import { extract, parse } from './adapters/comark.ts'
import { extractNavigation } from './adapters/navigation.ts'
import { listFiles, readBlobs, repoRoot } from './git.ts'

export interface Source {
  name: string
  ref: string
  cwd?: string
  dir?: string
}

export interface SegmentedFile extends Extracted {
  file: string
}

const byBlob = new Map<string, Promise<SegmentedFile>>()

/** Segments a file, memoised by blob SHA so unchanged files are parsed once across refs and commits. */
export function segmentBlob(file: string, blob: string, source: string): Promise<SegmentedFile> {
  const key = `${blob}:${file}`
  let hit = byBlob.get(key)
  if (!hit) {
    hit = file.endsWith('.yml')
      ? Promise.resolve({ file, segments: extractNavigation(file, source).segments, codeBlocks: [] })
      : parse(source).then(doc => extract(file, doc)).then(r => ({ file, ...r }))
    byBlob.set(key, hit)
  }
  return hit
}

export async function segmentSource({ ref, cwd = repoRoot, dir = 'docs' }: Source): Promise<SegmentedFile[]> {
  const files = listFiles(ref, dir, cwd).filter(f => isDocFile(f.path))
  const blobs = readBlobs(files.map(f => f.blob), cwd)
  return Promise.all(files.map(f => segmentBlob(f.path, f.blob, blobs.get(f.blob)!)))
}

export function isDocFile(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('/.navigation.yml')
}

export const NUXT_BRANCHES: Source[] = [
  { name: '3.x', ref: '3.x' },
  { name: '4.x', ref: '4.x' },
  { name: 'main', ref: 'HEAD' },
]

export const MODULE_REPOS: Source[] = ['fonts', 'icon', 'devtools', 'eslint', 'hints', 'cli']
  .map(name => ({ name, ref: 'HEAD', cwd: `/tmp/repos/${name}` }))
