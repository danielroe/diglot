import type { SourceConfig } from '@diglot/core'
import type { CloneUrl, ResolvedConfig } from '@diglot/store'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { ensureCheckouts, readSource } from '@diglot/store'
import { dirname, join, relative, resolve } from 'pathe'

export interface CheckedOutSource {
  name: string
  /** Absolute path of the exported working tree. */
  path: string
  /** Commit the source was exported at, when it has one. */
  sha?: string
}

/** Absolute export directory of a source under `<stateDir>/sources/<name>`. */
function sourceDir(config: ResolvedConfig, source: SourceConfig): string {
  const base = join(config.stateDir, 'sources')
  const target = resolve(base, source.name)
  const local = relative(base, target)
  if (!local || local === '..' || local.startsWith('../'))
    throw new Error(`source "${source.name}" must resolve inside ${relative(config.root, base)}`)
  return target
}

async function move(source: string, target: string): Promise<boolean> {
  try {
    await rename(source, target)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    throw error
  }
}

/**
 * Exports the documents a source yields to `extract` as plain files under
 * `<stateDir>/sources/<name>`. The checkout is ensured and fetched first, then the files
 * are written to a sibling directory and swapped into place over the previous export.
 */
export async function checkoutSource(config: ResolvedConfig, source: SourceConfig, options: { cloneUrl?: CloneUrl } = {}): Promise<CheckedOutSource> {
  const [resolved] = await ensureCheckouts(config, [source], options.cloneUrl)
  if (!resolved?.path)
    throw new Error(`source "${source.name}" has no checkout \`path\``)
  const snapshot = await readSource(resolved, config.root)

  const target = sourceDir(config, resolved)
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  const backup = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.bak`
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })

  let hadTarget = false
  try {
    for (const file of snapshot.files) {
      await mkdir(dirname(join(tmp, file.path)), { recursive: true })
      await writeFile(join(tmp, file.path), file.content)
    }
    hadTarget = await move(target, backup)
    await rename(tmp, target)
  }
  catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    if (hadTarget)
      await move(backup, target).catch(() => {})
    throw error
  }
  if (hadTarget)
    await rm(backup, { recursive: true, force: true }).catch(() => {})
  return { name: resolved.name, path: target, ...(snapshot.sha ? { sha: snapshot.sha } : {}) }
}
