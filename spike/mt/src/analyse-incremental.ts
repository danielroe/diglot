import { readFileSync, writeFileSync } from 'node:fs'
import { mask } from './placeholders.ts'
import { sentences } from './diff.ts'
import type { Locale } from './glossary.ts'

interface Row {
  id: string
  locale: Locale
  commit: string
  method: 'carry' | 'model'
  wordDiff?: string
  before: string
  after: string
  human: string
  update: string
  update2: string
  fresh: string
  toneLeak: { update: boolean, fresh: boolean }
  costUsd: number
  latencyMs: number
}

const file = process.argv[2] ?? 'incremental.fr-ja.json'
const rows: Row[] = JSON.parse(readFileSync(new URL(`../results/${file}`, import.meta.url), 'utf8'))

const values = (s: string) => mask(s).tokens.map(t => t.value).sort()

function preservation (r: Row, output: string) {
  const oldSrc = sentences(r.before, 'en')
  const newSrc = sentences(r.after, 'en')
  const hs = sentences(r.human, r.locale)
  const aligned = hs.length === oldSrc.length
  const unchanged = oldSrc.map((s, i) => newSrc.includes(s) ? i : -1).filter(i => i >= 0)
  const expected = aligned ? unchanged.map(i => hs[i]!) : hs
  const lost = expected.filter(h => !output.includes(h))
  return { aligned, expected: expected.length, kept: expected.length - lost.length, lost }
}

const lines: string[] = ['| case | locale | commit | kind | method | src sentences (unchanged) | aligned | update kept | update run 2 kept | fresh kept | update == human | runs agree | token values ok | tone kept (update / fresh) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
const KIND: Record<string, string> = { case1: 'clause added', case2: 'code only', case3: 'sentence added', case4: 'sentence rewritten', case5: 'code only', case6: 'sentence rewritten', case7: 'sentence rewritten', case8: 'phrase changed', case9: 'typo (article)', case10: 'typo (pronoun)', case11: 'markup only (_ to *)', case12: 'sentence added', case13: 'sentence removed', case14: 'code only', case15: 'sentence added' }
const totals: Record<string, { kept: number, expected: number, kept2: number, fresh: number, perfect: number, n: number, alignedKept: number, alignedExpected: number, toneUpdate: number, toneFresh: number, tokensOk: number, agree: number }> = {}
const lost: string[] = []
for (const r of rows) {
  const u = preservation(r, r.update)
  const u2 = preservation(r, r.update2)
  const f = preservation(r, r.fresh)
  const tokensOk = JSON.stringify(values(r.update)) === JSON.stringify(values(r.after))
  const src = sentences(r.before, 'en')
  const unchanged = src.filter(s => sentences(r.after, 'en').includes(s)).length
  lines.push(`| ${r.id} | ${r.locale} | ${r.commit} | ${KIND[r.id]} | ${r.method} | ${src.length} (${unchanged}) | ${u.aligned ? 'yes' : 'no'} | ${u.kept}/${u.expected} | ${u2.kept}/${u2.expected} | ${f.kept}/${f.expected} | ${r.update === r.human ? 'yes' : 'no'} | ${r.update === r.update2 ? 'yes' : 'no'} | ${tokensOk ? 'yes' : 'no'} | ${r.toneLeak.update ? 'no' : 'yes'} / ${r.toneLeak.fresh ? 'no' : 'yes'} |`)
  const t = totals[r.locale] ??= { kept: 0, expected: 0, kept2: 0, fresh: 0, perfect: 0, n: 0, alignedKept: 0, alignedExpected: 0, toneUpdate: 0, toneFresh: 0, tokensOk: 0, agree: 0 }
  t.kept += u.kept
  t.expected += u.expected
  t.kept2 += u2.kept
  t.fresh += f.kept
  t.n++
  if (u.kept === u.expected) { t.perfect++ }
  if (u.aligned) { t.alignedKept += u.kept; t.alignedExpected += u.expected }
  if (!r.toneLeak.update) { t.toneUpdate++ }
  if (!r.toneLeak.fresh) { t.toneFresh++ }
  if (tokensOk) { t.tokensOk++ }
  if (r.update === r.update2) { t.agree++ }
  for (const l of u.lost) { lost.push(`[${r.locale} ${r.id}${u.aligned ? '' : ' unaligned'}] ${l}`) }
}
const out = [
  '## Incremental re-translation', '',
  ...lines, '',
  '| locale | update kept (all) | update kept (aligned only) | update run 2 kept | fresh kept | cases fully preserved | token values ok | tone kept update / fresh | runs agree |', '|---|---|---|---|---|---|---|---|---|',
  ...Object.entries(totals).map(([l, t]) => `| ${l} | ${t.kept}/${t.expected} | ${t.alignedKept}/${t.alignedExpected} | ${t.kept2}/${t.expected} | ${t.fresh}/${t.expected} | ${t.perfect}/${t.n} | ${t.tokensOk}/${t.n} | ${t.toneUpdate}/${t.n} / ${t.toneFresh}/${t.n} | ${t.agree}/${t.n} |`), '',
  '### Sentences not found verbatim in the update', '', '```', ...lost, '```', '',
]
writeFileSync(new URL(file.replace(/\.json$/, '.md'), new URL('../results/', import.meta.url)), out.join('\n'))
console.log(out.join('\n'))
