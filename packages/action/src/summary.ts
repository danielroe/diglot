import type { RunResult } from './run.ts'

/** Step outputs of a run. */
export function outputs(result: RunResult): Record<string, string> {
  return {
    translated: String(result.totals.translated),
    updated: String(result.totals.updated),
    carried: String(result.totals.carried),
    rejected: String(result.totals.rejected),
    costUsd: result.totals.costUsd === undefined ? '' : String(result.totals.costUsd),
    committed: String(Boolean(result.sha)),
    sha: result.sha ?? '',
  }
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** A markdown job summary of a run. */
export function summary(result: RunResult): string {
  const lines = [
    '## diglot',
    '',
    '| Locale | MT | Translated | Updated | Carried | Rejected | Deferred | Requests | Tokens in / out | Cost (USD) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.locales.map(l => `| ${l.locale} | ${l.enabled ? 'on' : 'off'} | ${l.translated} | ${l.updated} | ${l.carried} | ${l.rejected} | ${l.deferred} | ${l.usage.requests} | ${l.usage.inputTokens} / ${l.usage.outputTokens} | ${l.usage.costUsd?.toFixed(4) ?? ''} |`),
    '',
    '| Source | Revision | Segments | Added | Removed | Modified |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...result.sources.map(s => `| ${s.name} | ${s.previous && s.previous !== s.sha ? `${s.previous.slice(0, 10)}..` : ''}${s.sha?.slice(0, 10) ?? ''} | ${s.segments} | ${s.added} | ${s.removed} | ${s.modified} |`),
    '',
    result.sha ? `Committed \`${result.sha.slice(0, 10)}\`: ${result.message!.split('\n')[0]}` : result.changed ? 'Changes left uncommitted.' : 'No changes.',
  ]
  const rejections = result.locales.flatMap(l => l.rejections.map(r => ({ locale: l.locale, ...r })))
  if (rejections.length) {
    lines.push('', '<details><summary>Rejected segments</summary>', '', '| Locale | Hash | File | Issues |', '| --- | --- | --- | --- |')
    for (const r of rejections.slice(0, 100))
      lines.push(`| ${r.locale} | \`${r.hash}\` | ${cell(r.file ?? '')} | ${cell(r.issues.filter(i => i.severity === 'error').map(i => `${i.check}: ${i.message}`).join('; '))} |`)
    if (rejections.length > 100)
      lines.push('', `${rejections.length - 100} more not shown.`)
    lines.push('', '</details>')
  }
  return `${lines.join('\n')}\n`
}
