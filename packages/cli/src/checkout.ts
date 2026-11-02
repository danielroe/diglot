import type { SourceConfig } from '@diglot/core'
import type { CloneUrl, ResolvedConfig } from '@diglot/store'
import { execFile } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { matchesGlob } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { DEFAULT_INCLUDE, ensureCheckouts } from '@diglot/store'
import { join, relative, resolve } from 'pathe'

const exec = promisify(execFile)

export interface CheckedOutSource {
  name: string
  /** Absolute path of the exported working tree. */
  path: string
  /** Commit the source was exported at. */
  sha: string
}

/** Absolute export directory of a source under `<stateDir>/sources/<name>`. */
function sourceDir(config: ResolvedConfig, source: SourceConfig): string {
  return join(config.stateDir, 'sources', source.name)
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1 << 28, encoding: 'utf8' })
  return stdout
}

/**
 * Exports the documents of a source at its configured `ref` as plain files under
 * `<stateDir>/sources/<name>`. The bare checkout is ensured and fetched first, then the
 * selected files are written to a sibling directory and swapped in atomically.
 */
export async function checkoutSource(config: ResolvedConfig, source: SourceConfig, options: { cloneUrl?: CloneUrl } = {}): Promise<CheckedOutSource> {
  const [resolved] = await ensureCheckouts(config, [source], options.cloneUrl)
  if (!resolved?.path)
    throw new Error(`source "${source.name}" has no checkout \`path\``)
  if (!resolved.ref)
    throw new Error(`source "${source.name}" has no \`ref\` to export`)
  const checkout = resolve(config.root, resolved.path)
  const sha = (await git(checkout, ['rev-parse', '--verify', `${resolved.ref}^{commit}`])).trim()
  const dir = resolved.dir ?? '.'
  const include = resolved.include ?? DEFAULT_INCLUDE
  const exclude = resolved.exclude ?? []
  const selected = (path: string) => {
    const local = relative(dir, path)
    return !local.startsWith('..') && include.some(p => matchesGlob(local, p)) && !exclude.some(p => matchesGlob(local, p))
  }
  const tree = await git(checkout, ['ls-tree', '-r', '-z', sha, '--', dir])
  const files = tree.split('\0').filter(Boolean).map(line => line.split('\t')[1]!).filter(selected)

  const target = sourceDir(config, resolved)
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}`
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    if (files.length) {
      const archive = `${tmp}.tar`
      await exec('git', ['archive', '--format=tar', '-o', archive, sha, '--', ...files], { cwd: checkout, maxBuffer: 1 << 28 })
      await exec('tar', ['-xf', archive, '-C', tmp], { maxBuffer: 1 << 28 })
      await rm(archive, { force: true })
    }
    await rm(target, { recursive: true, force: true })
    await rename(tmp, target)
  }
  catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return { name: resolved.name, path: target, sha }
}
