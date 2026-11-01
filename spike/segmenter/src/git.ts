import { execFileSync, spawnSync } from 'node:child_process'

export interface GitFile {
  path: string
  blob: string
}

const blobCache = new Map<string, string>()

export const repoRoot = process.env.SPIKE_REPO
  ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

export function git(args: string[], cwd = repoRoot): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
}

export function listFiles(ref: string, dir = 'docs', cwd?: string): GitFile[] {
  const out = git(['ls-tree', '-r', ref, '--', dir], cwd)
  return out.split('\n').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t')
    return { path: path!, blob: meta!.split(' ')[2]! }
  })
}

export function readBlobs(blobs: string[], cwd = repoRoot): Map<string, string> {
  const missing = [...new Set(blobs)].filter(b => !blobCache.has(b))
  if (missing.length) {
    const res = spawnSync('git', ['cat-file', '--batch'], { cwd, input: missing.join('\n') + '\n', maxBuffer: 1 << 30 })
    const buf = res.stdout
    let offset = 0
    while (offset < buf.length) {
      const nl = buf.indexOf(10, offset)
      const [sha, , size] = buf.subarray(offset, nl).toString().split(' ')
      const len = Number(size)
      blobCache.set(sha!, buf.subarray(nl + 1, nl + 1 + len).toString('utf8'))
      offset = nl + 1 + len + 1
    }
  }
  return new Map(blobs.map(b => [b, blobCache.get(b)!]))
}

export function readTree(ref: string, dir = 'docs', cwd?: string, filter = (p: string) => p.endsWith('.md')) {
  const files = listFiles(ref, dir, cwd).filter(f => filter(f.path))
  const blobs = readBlobs(files.map(f => f.blob), cwd)
  return files.map(f => ({ ...f, source: blobs.get(f.blob)! }))
}
