import type { SourceConfig } from '@diglot/core'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { matchesGlob } from 'node:path'
import { promisify } from 'node:util'
import { join, relative, resolve } from 'pathe'
import { parse as parseYaml } from 'yaml'

const exec = promisify(execFile)

/** Default document patterns of a source. */
export const DEFAULT_INCLUDE: string[] = ['**/*.md', '**/.navigation.yml']

/** Parses `sources.yml`: either a list of sources or `{ sources: [...] }`. */
export function parseSources(content: string): SourceConfig[] {
  const data = parseYaml(content) as unknown
  const list = Array.isArray(data) ? data : (data as { sources?: unknown } | null)?.sources ?? []
  if (!Array.isArray(list))
    throw new Error('sources.yml: `sources` must be a list')
  const names = new Set<string>()
  return list.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !/^[\w.-]+$/.test(entry.name))
      throw new Error(`sources.yml: source ${i} needs a \`name\` made of letters, digits, dots, dashes or underscores`)
    if (names.has(entry.name))
      throw new Error(`sources.yml: duplicate source name "${entry.name}"`)
    names.add(entry.name)
    for (const key of ['repo', 'ref', 'path', 'dir'] as const) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string')
        throw new Error(`sources.yml: \`${key}\` of "${entry.name}" must be a string`)
    }
    for (const key of ['include', 'exclude'] as const) {
      if (entry[key] !== undefined && (!Array.isArray(entry[key]) || entry[key].some((p: unknown) => typeof p !== 'string')))
        throw new Error(`sources.yml: \`${key}\` of "${entry.name}" must be a list of strings`)
    }
    return entry as SourceConfig
  })
}

export interface SourceFile {
  /** Path relative to the checkout root. */
  path: string
  content: string
}

export interface SourceSnapshot {
  source: SourceConfig
  /** Commit the files were read at, when the checkout is a git repository. */
  sha?: string
  files: SourceFile[]
}

/**
 * Reads the documents of a source from its local checkout: at `ref` through git when set,
 * otherwise from the working tree. `path` is resolved against `cwd`.
 */
export async function readSource(source: SourceConfig, cwd: string): Promise<SourceSnapshot> {
  if (!source.path)
    throw new Error(`source "${source.name}" has no local \`path\``)
  const checkout = resolve(cwd, source.path)
  const dir = source.dir ?? '.'
  const include = source.include ?? DEFAULT_INCLUDE
  const exclude = source.exclude ?? []
  const selected = (path: string) => {
    const local = relative(dir, path)
    return !local.startsWith('..') && include.some(p => matchesGlob(local, p)) && !exclude.some(p => matchesGlob(local, p))
  }

  if (source.ref) {
    const sha = (await git(checkout, ['rev-parse', '--verify', `${source.ref}^{commit}`])).trim()
    const tree = await git(checkout, ['ls-tree', '-r', '-z', sha, '--', dir])
    const entries = tree.split('\0').filter(Boolean).map((line) => {
      const [meta, path] = line.split('\t') as [string, string]
      return { path, blob: meta.split(' ')[2]! }
    }).filter(e => selected(e.path))
    const blobs = await readBlobs(checkout, entries.map(e => e.blob))
    return { source, sha, files: entries.map(e => ({ path: e.path, content: blobs.get(e.blob)! })).sort(byPath) }
  }

  const paths = globSync(include, { cwd: join(checkout, dir), exclude }).map(p => join(dir, p).replace(/^\.\//, ''))
  const files = await Promise.all(paths.map(async path => ({ path, content: await readFile(join(checkout, path), 'utf8') })))
  const sha = await git(checkout, ['rev-parse', 'HEAD']).then(s => s.trim(), () => undefined)
  return { source, ...(sha ? { sha } : {}), files: files.sort(byPath) }
}

function byPath(a: SourceFile, b: SourceFile): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1 << 28, encoding: 'utf8' })
  return stdout
}

function readBlobs(cwd: string, blobs: string[]): Promise<Map<string, string>> {
  return new Promise((done, fail) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', fail)
    child.on('close', (code) => {
      if (code !== 0)
        return fail(new Error(`git cat-file exited with ${code}`))
      const buffer = Buffer.concat(chunks)
      const out = new Map<string, string>()
      let offset = 0
      while (offset < buffer.length) {
        const newline = buffer.indexOf(10, offset)
        const [sha, , size] = buffer.subarray(offset, newline).toString().split(' ')
        const length = Number(size)
        out.set(sha!, buffer.subarray(newline + 1, newline + 1 + length).toString('utf8'))
        offset = newline + 1 + length + 1
      }
      done(out)
    })
    child.stdin.end(`${[...new Set(blobs)].join('\n')}\n`)
  })
}
