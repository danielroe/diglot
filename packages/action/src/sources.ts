import type { Segment, SourceConfig } from '@diglot/core'
import type { ResolvedConfig, SourceSnapshot } from '@diglot/store'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { extract as extractComark, extractNavigation, parse } from '@diglot/comark'
import { extract as extractMdast } from '@diglot/mdast'
import { readSource } from '@diglot/store'
import { join, relative, resolve } from 'pathe'

const exec = promisify(execFile)

export interface ExtractedSource {
  source: SourceConfig
  snapshot: SourceSnapshot
  files: Record<string, Segment[]>
}

export async function extractSource(config: ResolvedConfig, source: SourceConfig): Promise<ExtractedSource> {
  const snapshot = await readSource(source, config.root)
  const files: Record<string, Segment[]> = {}
  for (const { path, content } of snapshot.files) {
    if (path.endsWith('.yml') || path.endsWith('.yaml'))
      files[path] = extractNavigation(content, { file: path, policy: config.policy })
    else if (config.parser === 'mdast')
      files[path] = await extractMdast(content, { file: path, policy: config.policy })
    else
      files[path] = (await extractComark(await parse(content), { file: path, policy: config.policy })).segments
  }
  return { source, snapshot, files }
}

/** Clone URL of a `owner/repo` source. */
export type CloneUrl = (repo: string) => string

const githubUrl: CloneUrl = repo => `https://github.com/${repo}.git`

/**
 * Makes sure every source has a local checkout. A missing checkout (default path
 * `<stateDir>/checkouts/<repo>`) is created as a bare repository and the refs of its
 * sources are fetched shallowly; existing bare checkouts are refreshed; working copies are
 * left alone.
 */
export async function ensureCheckouts(config: ResolvedConfig, sources: SourceConfig[], cloneUrl: CloneUrl = githubUrl): Promise<SourceConfig[]> {
  const resolved = sources.map(source => source.path || !source.repo
    ? source
    : { ...source, path: relative(config.root, join(config.stateDir, 'checkouts', source.repo)) })
  const byPath = Map.groupBy(resolved.filter(s => s.path), s => resolve(config.root, s.path!))
  for (const [path, group] of byPath) {
    const working = existsSync(join(path, '.git'))
    if (working)
      continue
    if (!existsSync(path)) {
      const repo = group.find(s => s.repo)?.repo
      if (!repo)
        continue
      await mkdir(path, { recursive: true })
      await git(path, ['init', '-q', '--bare'])
      await git(path, ['remote', 'add', 'origin', cloneUrl(repo)])
    }
    else if (!existsSync(join(path, 'HEAD'))) {
      continue
    }
    const refs = [...new Set(group.map((s) => {
      if (!s.ref)
        throw new Error(`source "${s.name}" needs a \`ref\` to be fetched into ${relative(config.root, path)}`)
      return s.ref
    }))]
    await git(path, ['fetch', '-q', '--depth=1', '--force', 'origin', ...refs.map(ref => `${ref}:refs/heads/${ref}`)])
  }
  return resolved
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 })
  return stdout
}
