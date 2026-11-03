import { appendFile } from 'node:fs/promises'
import process from 'node:process'
import { run } from './run.ts'
import { outputs, summary } from './summary.ts'

const input = (name: string) => process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`]?.trim() ?? ''
const list = (value: string) => value.split(/[\s,]+/).filter(Boolean)

async function main() {
  const limit = input('limit')
  const result = await run({
    cwd: input('working-directory') || '.',
    locales: list(input('locales')),
    sources: list(input('sources')),
    ...(input('model') ? { model: input('model') } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
    retryRejected: input('retry-rejected') === 'true',
    commit: input('commit') !== 'false',
    buildDist: input('build-dist') !== 'false',
    author: { name: input('git-user-name') || 'diglot[bot]', email: input('git-user-email') || 'diglot[bot]@users.noreply.github.com' },
    log: message => process.stdout.write(`${message}\n`),
  })
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(outputs(result)).map(([k, v]) => `${k}=${v}\n`).join(''))
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(result))
  process.stdout.write(`${result.sha ? `committed ${result.sha}` : result.changed ? 'changes left uncommitted' : 'no changes'}\n`)
}

main().catch((error: Error) => {
  process.stdout.write(`::error::${error.message.replace(/\n/g, '%0A')}\n`)
  process.exitCode = 1
})
