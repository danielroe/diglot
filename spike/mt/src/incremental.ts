import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { mask, maskWith, unmask } from './placeholders.ts'
import { sentences } from './diff.ts'
import { systemPrompt, userPrompt } from './prompts.ts'
import { callModel } from './translate.ts'
import { updateTranslation, unionTokens } from './update.ts'
import { checkPlaceholders } from './qa.ts'
import type { Locale } from './glossary.ts'

interface Case { id: string, commit: string, file: string, before: string, after: string }

const HUMAN_STYLE: Record<Locale, string> = {
  fr: 'House style for this translation: address the reader informally as "tu" (never "vous"), and prefer idiomatic, fairly free phrasing over a literal rendering.',
  ja: 'House style for this translation: write in the plain である/だ style (never です/ます), and prefer idiomatic, fairly free phrasing over a literal rendering.',
}

const cases: Case[] = JSON.parse(readFileSync(new URL('../data/incremental-cases.json', import.meta.url), 'utf8'))
const schema = z.object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) })

async function translateOne (text: string, locale: Locale, extra = ''): Promise<{ text: string, costUsd: number }> {
  const m = mask(text)
  const r = await callModel(systemPrompt({ locale, glossary: true }) + (extra ? `\n\n${extra}` : ''), userPrompt([{ id: 's1', kind: 'paragraph', text: m.masked }]), schema)
  return { text: unmask(r.output.translations[0]!.text, m.tokens), costUsd: r.costUsd }
}

function preservation (c: Case, human: string, output: string, locale: Locale) {
  const n = mask(c.after)
  const tokens = unionTokens(n.tokens, mask(c.before).tokens)
  const oldSrc = sentences(maskWith(c.before, tokens), 'en')
  const newSrc = sentences(n.masked, 'en')
  const humanMasked = maskWith(human, tokens)
  const outMasked = maskWith(output, tokens)
  const hs = sentences(humanMasked, locale)
  const aligned = hs.length === oldSrc.length
  const unchanged = oldSrc.map((s, i) => newSrc.includes(s) ? i : -1).filter(i => i >= 0)
  const expected = aligned ? unchanged.map(i => hs[i]!) : hs
  const kept = expected.filter(h => outMasked.includes(h))
  return { aligned, sourceSentences: oldSrc.length, unchangedSourceSentences: unchanged.length, humanSentences: hs.length, expected: expected.length, kept: kept.length, lost: expected.filter(h => !outMasked.includes(h)) }
}

const glossary = process.env.GLOSSARY === '1'
const dedupe = process.env.FINAL === '1'
const locales = (process.argv.slice(2).length ? process.argv.slice(2) : ['fr', 'ja']) as Locale[]
const humanFile = new URL('../data/incremental-human.json', import.meta.url)
const human: Record<string, string> = existsSync(humanFile) ? JSON.parse(readFileSync(humanFile, 'utf8')) : {}
const results: unknown[] = []
for (const locale of locales) {
  await Promise.all(cases.map(async (c) => {
    const key = `${locale}:${c.id}`
    human[key] ??= (await translateOne(c.before, locale, HUMAN_STYLE[locale])).text
  }))
  writeFileSync(humanFile, JSON.stringify(human, null, 2) + '\n')
  const rows = await Promise.all(cases.map(async (c) => {
    const prev = { source: c.before, text: human[`${locale}:${c.id}`]!, locale }
    const [u1, u2, fresh] = await Promise.all([
      updateTranslation(prev, c.after, { glossary, dedupe }),
      updateTranslation(prev, c.after, { glossary, dedupe }),
      translateOne(c.after, locale),
    ])
    const n = mask(c.after)
    const tokens = unionTokens(n.tokens, mask(c.before).tokens)
    const ph = (t: string) => checkPlaceholders(n.masked, maskWith(t, tokens), tokens).filter(q => q.severity === 'error').map(q => q.message)
    const toneLeak = (t: string) => locale === 'fr' ? /\bvous\b/i.test(t) : /(?:です|ます)[。、]/.test(t)
    return {
      id: c.id,
      locale,
      commit: c.commit,
      file: c.file,
      method: u1.method,
      wordDiff: u1.wordDiff,
      before: c.before,
      after: c.after,
      human: prev.text,
      update: u1.text,
      update2: u2.text,
      fresh: fresh.text,
      identicalToHuman: u1.text === prev.text,
      runsAgree: u1.text === u2.text,
      updatePreservation: preservation(c, prev.text, u1.text, locale),
      update2Preservation: preservation(c, prev.text, u2.text, locale),
      freshPreservation: preservation(c, prev.text, fresh.text, locale),
      updatePlaceholderErrors: ph(u1.text),
      toneLeak: { update: toneLeak(u1.text), fresh: toneLeak(fresh.text) },
      costUsd: u1.costUsd + u2.costUsd + fresh.costUsd,
      latencyMs: u1.latencyMs,
    }
  }))
  results.push(...rows)
  const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
  console.log(locale,
    'update kept', `${sum(r => r.updatePreservation.kept)}/${sum(r => r.updatePreservation.expected)}`,
    'update2 kept', `${sum(r => r.update2Preservation.kept)}/${sum(r => r.update2Preservation.expected)}`,
    'fresh kept', `${sum(r => r.freshPreservation.kept)}/${sum(r => r.freshPreservation.expected)}`,
    'perfect cases', rows.filter(r => r.updatePreservation.kept === r.updatePreservation.expected).length, '/', rows.length,
    'aligned', rows.filter(r => r.updatePreservation.aligned).length,
    'runsAgree', rows.filter(r => r.runsAgree).length,
    'tone leak update/fresh', rows.filter(r => r.toneLeak.update).length, rows.filter(r => r.toneLeak.fresh).length,
    'ph errors', rows.filter(r => r.updatePlaceholderErrors.length).length,
    `$${sum(r => r.costUsd).toFixed(3)}`)
}
writeFileSync(new URL(`../results/incremental${glossary ? '-glossary' : ''}${dedupe ? '-final' : ''}.${locales.join('-')}.json`, import.meta.url), JSON.stringify(results, null, 1) + '\n')
