import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { promisify } from 'node:util'
import { join } from 'pathe'

const exec = promisify(execFile)

export interface CommitOptions {
  /** Paths to leave out, relative to the root. */
  exclude?: string[]
  /** Paths to add even when a gitignore file matches them. */
  force?: string[]
  /** Commit identity. Without it, only reports whether there are changes. */
  author?: { name: string, email: string }
}

/** Commits the changes under `paths` and `force` (relative to `root`) as one commit. */
export async function commitChanges(root: string, paths: string[], message: string, options: CommitOptions = {}): Promise<{ changed: boolean, sha?: string }> {
  const git = async (args: string[], env: Record<string, string> = {}) => (await exec('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } })).stdout
  const included = paths.filter(p => existsSync(join(root, p)))
  const forced = (options.force ?? []).filter(p => existsSync(join(root, p)))
  const pathspec = [...included, ...(options.exclude ?? []).map(p => `:(exclude)${p}`)]
  let status = ''
  if (included.length)
    status += await git(['status', '--porcelain', '--untracked-files=all', '--', ...pathspec])
  if (forced.length)
    status += await git(['status', '--porcelain', '--untracked-files=all', '--ignored=matching', '--', ...forced])
  if (!status.trim())
    return { changed: false }
  if (!options.author)
    return { changed: true }
  if (included.length)
    await git(['add', '-A', '--', ...pathspec])
  if (forced.length)
    await git(['add', '-A', '--force', '--', ...forced])
  const { name, email } = options.author
  await git(['commit', '-q', '-m', message], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email })
  return { changed: true, sha: (await git(['rev-parse', 'HEAD'])).trim() }
}
