import type { ReviewData } from '@x18n/core'
import type { CommandDef } from 'citty'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'
import { ReviewFileSchema, validate } from '@x18n/core'
import { defineCommand, runMain } from 'citty'
import { parse } from 'yaml'
import { applyReviews } from './reviews.ts'

const exec = promisify(execFile)

async function command(file: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec(file, args, { encoding: 'utf8' })
    return stdout.trim() || undefined
  }
  catch {
    return undefined
  }
}

export interface ReviewerIdentity {
  gh: () => Promise<string | undefined>
  git: () => Promise<string | undefined>
}

export const defaultReviewerIdentity: ReviewerIdentity = {
  gh: () => command('gh', ['api', 'user', '--jq', '.login']),
  git: () => command('git', ['config', 'user.name']),
}

/** Resolves the reviewer login: explicit `reviewer`, then `GITHUB_ACTOR`, then `gh`, then git `user.name`. */
export async function resolveReviewer(reviewer: string | undefined, env: NodeJS.ProcessEnv = process.env, identity: ReviewerIdentity = defaultReviewerIdentity): Promise<string | undefined> {
  if (reviewer)
    return reviewer
  const actor = env.GITHUB_ACTOR?.trim()
  if (actor)
    return actor
  return await identity.gh() ?? await identity.git()
}

async function readReviews(path: string): Promise<ReviewData> {
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  const result = validate(ReviewFileSchema, parse(text ?? '') ?? { x18n: 1 })
  if (!result.success)
    throw new Error(result.issues.map(issue => `${issue.path || '(root)'}: ${issue.message}`).join('; '))
  return { threads: result.output.threads ?? {}, sources: result.output.sources ?? {} }
}

const applyReviewsCommand = defineCommand({
  meta: { name: 'apply-reviews', description: 'Apply x18n approve reviews to the record files' },
  args: {
    reviewer: { type: 'string', description: 'GitHub login recorded as the reviewer' },
  },
  async run({ args }) {
    const data = await readReviews('.x18n/reviews.yml')
    const reviewer = await resolveReviewer(args.reviewer)
    const written = await applyReviews('.', data, reviewer)
    if (written.length)
      process.stdout.write(`${written.join('\n')}\n`)
  },
})

/** The `diglot-x18n` command. */
export const main: CommandDef = defineCommand({
  meta: { name: 'diglot-x18n', description: 'Tools for diglot x18n review stores' },
  subCommands: { 'apply-reviews': applyReviewsCommand },
})

/** Runs the CLI with `process.argv`. */
export function run(): Promise<void> {
  return runMain(main)
}
