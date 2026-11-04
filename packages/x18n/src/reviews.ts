import type { Plugin, ReviewAuthor } from '@x18n/core'
import type { DiglotState } from './state.ts'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { verifyRecord } from '@diglot/core'
import { validationTarget } from '@diglot/store'
import { parseRawRecord, RECORD_FORMAT, serialiseRaw } from './format.ts'

type Reviewer = (author: ReviewAuthor | undefined) => string | undefined

const NOREPLY = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i

function run(file: string, args: string[], cwd?: string): string | undefined {
  try {
    return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || undefined
  }
  catch {
    return undefined
  }
}

export function gitIdentity(cwd?: string): ReviewAuthor | undefined {
  const name = run('git', ['config', 'user.name'], cwd)
  const email = run('git', ['config', 'user.email'], cwd)
  return name || email ? { name, email } : undefined
}

interface ReviewerSources {
  env?: NodeJS.ProcessEnv
  gh?: () => string | undefined
  git?: () => ReviewAuthor | undefined
}

export function githubReviewer({ env = process.env, gh = () => run('gh', ['api', 'user', '--jq', '.login']), git = gitIdentity }: ReviewerSources = {}): Reviewer {
  let identity: { author: ReviewAuthor | undefined } | undefined
  let login: { value: string | undefined } | undefined
  return (author) => {
    const noreply = author?.email && NOREPLY.exec(author.email)?.[1]
    if (noreply)
      return noreply
    if (author?.name || author?.email) {
      identity ??= { author: git() }
      if (author.name !== identity.author?.name || author.email !== identity.author?.email)
        return author.name || author.email
    }
    login ??= { value: env.GITHUB_ACTOR?.trim() || gh() }
    return login.value ?? (author?.name || author?.email)
  }
}

export function reviewEdit(state: DiglotState, reviewer: Reviewer): NonNullable<Plugin['reviewEdit']> {
  return (edit, ctx) => {
    if (edit.type !== 'approve' || edit.comment.value === undefined)
      return undefined
    const message = ctx.message(edit.key, edit.locale)
    const resource = message && ctx.resource(message.resource)
    if (resource?.format !== RECORD_FORMAT)
      return undefined
    const text = ctx.text(resource.path)
    const parsed = text === undefined ? undefined : parseRawRecord(text)
    if (parsed?.record.text !== edit.comment.value)
      return undefined
    const by = reviewer(edit.comment.author)
    if (!by)
      return undefined
    const segment = state.segments.get(edit.key)
    const result = verifyRecord(parsed.record, { by, at: edit.comment.time, expected: edit.comment.value, segment: segment && validationTarget(segment) })
    return result.ok ? [{ path: resource.path, content: serialiseRaw({ ...result.record, ...parsed.extra }) }] : undefined
  }
}
