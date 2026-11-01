import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { runQa, lengthRatio, type QaCheck } from './qa.ts'
import { checkGlossary, GLOSSARY, type Locale } from './glossary.ts'
import { PLACEHOLDER_RE } from './placeholders.ts'
import type { RunResult } from './translate.ts'

const dir = new URL('../results/', import.meta.url)
const files = readdirSync(dir).filter(f => /^(stress-)?(v\d|b)[\w-]+\.(fr|ja)\.json$/.test(f)).sort()
const CHECKS: QaCheck[] = ['placeholders', 'untranslated', 'length-ratio', 'leaked-instructions', 'markdown-structure', 'block-type', 'numbers', 'whitespace']

const sentences = (s: string, locale: string) => [...new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(s.replace(PLACEHOLDER_RE, 'X'))].filter(x => x.segment.trim()).length

const rows: string[] = []
const qaRows: string[] = []
const glossRows: string[] = []
const costRows: string[] = []
const alignRows: string[] = []
const examples: Record<string, string[]> = {}
const summary: Record<string, unknown> = {}

for (const f of files) {
  const run: RunResult = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
  const name = f.replace(/\.json$/, '')
  const locale = run.options.locale as Locale
  const segs = run.segments.filter(s => s.targetMasked !== null)
  const withPh = segs.filter(s => s.tokens.length > 0)
  const flagged: Record<string, number> = Object.fromEntries(CHECKS.map(c => [c, 0]))
  let phFail = 0
  let phStrict = 0
  for (const s of segs) {
    const qa = runQa({ locale, sourceMasked: s.sourceMasked, targetMasked: s.targetMasked!, tokens: s.tokens, source: s.source, target: s.target! })
    const checks = new Set(qa.map(q => q.check))
    for (const c of checks) { flagged[c]!++ }
    if (checks.has('placeholders')) {
      phStrict++
      if (qa.some(q => q.check === 'placeholders' && q.severity === 'error')) { phFail++ }
      ;(examples[`placeholders ${name}`] ??= []).push(`${s.id}\n  src: ${s.sourceMasked}\n  out: ${s.targetMasked}\n  ${qa.filter(q => q.check === 'placeholders').map(q => q.message).join('; ')}`)
    }
    for (const c of checks) {
      if (c === 'placeholders') { continue }
      ;(examples[`${c} ${locale}`] ??= []).push(`[${name}] ${s.id}: ${qa.filter(q => q.check === c).map(q => q.message).join('; ')}\n  src: ${s.sourceMasked}\n  out: ${s.targetMasked}`)
    }
  }
  rows.push(`| ${name} | ${segs.length}/${run.segments.length} | ${withPh.length} | ${phStrict} (${(100 * phStrict / segs.length).toFixed(1)}%) | ${phFail} (${(100 * phFail / segs.length).toFixed(1)}%) |`)
  qaRows.push(`| ${name} | ${CHECKS.map(c => flagged[c]).join(' | ')} |`)

  const hits = segs.flatMap(s => checkGlossary(s.sourceMasked, s.targetMasked!, locale).map(h => ({ ...h, id: s.id, out: s.targetMasked! })))
  const byDecision = (d: string) => { const h = hits.filter(x => x.decision === d); return `${h.filter(x => x.ok).length}/${h.length}` }
  const misses = hits.filter(h => !h.ok)
  const missTerms = Object.entries(misses.reduce<Record<string, number>>((a, m) => ({ ...a, [m.term]: (a[m.term] ?? 0) + 1 }), {})).map(([t, n]) => `${t}×${n}`).join(', ')
  let glossFirst = 0
  let glossTotal = 0
  for (const entry of GLOSSARY) {
    const d = entry.locales[locale]
    if (d.decision !== 'keep-gloss') { continue }
    const pages = new Set(segs.map(s => s.id.split('#')[0]))
    for (const p of pages) {
      const first = segs.find(s => s.id.startsWith(p + '#') && s.kind !== 'title' && entry.match.test(s.sourceMasked))
      if (!first) { continue }
      glossTotal++
      if (first.targetMasked!.toLowerCase().includes(d.gloss)) { glossFirst++ }
    }
  }
  glossRows.push(`| ${name} | ${hits.filter(h => h.ok).length}/${hits.length} (${(100 * hits.filter(h => h.ok).length / Math.max(1, hits.length)).toFixed(0)}%) | ${byDecision('keep')} | ${byDecision('translate')} | ${byDecision('keep-gloss')} | ${glossFirst}/${glossTotal} | ${missTerms || '-'} |`)
  for (const m of misses) { (examples[`glossary ${name}`] ??= []).push(`${m.id} [${m.term}]: ${m.out}`) }

  const reqs = run.requests
  const cost = reqs.reduce((a, r) => a + r.costUsd, 0)
  const inTok = reqs.reduce((a, r) => a + r.inputTokens, 0)
  const outTok = reqs.reduce((a, r) => a + r.outputTokens, 0)
  const lat = reqs.map(r => r.latencyMs).sort((a, b) => a - b)
  const idFail = reqs.filter(r => !r.idsRoundTrip).length
  costRows.push(`| ${name} | ${reqs.length} | ${idFail} | ${(inTok / segs.length).toFixed(0)} | ${(outTok / segs.length).toFixed(0)} | $${(1000 * cost / segs.length).toFixed(2)} | ${lat[Math.floor(lat.length / 2)]} | ${lat[lat.length - 1]} | ${(100 * phFail / segs.length).toFixed(1)}% |`)

  const prose = segs.filter(s => ['paragraph', 'callout', 'list-item', 'description'].includes(s.kind))
  let match = 0
  const mismatches: string[] = []
  for (const s of prose) {
    const a = sentences(s.sourceMasked, 'en')
    const b = sentences(s.targetMasked!, locale)
    if (a === b) { match++ }
    else { mismatches.push(`${s.id}: en ${a} vs ${locale} ${b}`) }
  }
  const multi = prose.filter(s => sentences(s.sourceMasked, 'en') > 1)
  const multiMatch = multi.filter(s => sentences(s.sourceMasked, 'en') === sentences(s.targetMasked!, locale)).length
  alignRows.push(`| ${name} | ${match}/${prose.length} | ${multiMatch}/${multi.length} |`)
  if (name.startsWith('v1')) { examples[`sentence mismatches ${name}`] = mismatches }
  const ratios = prose.map(s => lengthRatio(s.sourceMasked, s.targetMasked!)).sort((a, b) => a - b)
  summary[name] = { phFail, segments: segs.length, cost, ratioP10: ratios[Math.floor(ratios.length * 0.1)], ratioMedian: ratios[Math.floor(ratios.length / 2)], ratioP90: ratios[Math.floor(ratios.length * 0.9)] }
}

const out = [
  '## Placeholder fidelity', '',
  '| run | translated | segments with placeholders | strict failures (exactly once) | hard failures (duplicated code allowed) |', '|---|---|---|---|---|', ...rows, '',
  '## QA flags (segments flagged per check)', '',
  `| run | ${CHECKS.join(' | ')} |`, `|---|${CHECKS.map(() => '---').join('|')}|`, ...qaRows, '',
  '## Glossary adherence', '',
  '| run | all | keep | translate | keep (gloss) | gloss on first use | misses |', '|---|---|---|---|---|---|---|', ...glossRows, '',
  '## Cost and latency', '',
  '| run | requests | id round-trip failures | input tok/seg | output tok/seg | $ per 1000 segs | p50 ms | max ms | placeholder fail |', '|---|---|---|---|---|---|---|---|---|', ...costRows, '',
  '## Sentence count agreement (Intl.Segmenter)', '',
  '| run | all prose segments | multi-sentence segments |', '|---|---|---|', ...alignRows, '',
  '## Length ratios', '', '```json', JSON.stringify(summary, null, 1), '```', '',
  '## Examples', '',
  ...Object.entries(examples).flatMap(([k, v]) => [`### ${k}`, '', '```', ...v.slice(0, 12), '```', '']),
]
writeFileSync(new URL('analysis.md', dir), out.join('\n'))
console.log(out.slice(0, 80).join('\n'))
