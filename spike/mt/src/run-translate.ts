import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { Segment } from './extract.ts'
import type { Locale } from './glossary.ts'
import { runTranslation, type TranslateOptions } from './translate.ts'

export const VARIANTS: Record<string, Omit<TranslateOptions, 'locale'>> = {
  'v0-plain': { glossary: false, context: 'none', batchSize: 1 },
  'v1-glossary': { glossary: true, context: 'none', batchSize: 1 },
  'v2-glossary-context': { glossary: true, context: 'neighbours', batchSize: 1 },
  'b10-glossary': { glossary: true, context: 'none', batchSize: 10 },
  'bpage-glossary': { glossary: true, context: 'none', batchSize: 'page' },
  'v1-final': { glossary: true, context: 'none', batchSize: 1, final: true },
  'bpage-final': { glossary: true, context: 'none', batchSize: 'page', final: true },
}

const set = process.env.SET ?? 'segments'
const prefix = set === 'segments' ? '' : `${set}-`
const segments: Segment[] = JSON.parse(readFileSync(new URL(`../data/${set}.json`, import.meta.url), 'utf8'))
const [variant, ...locales] = process.argv.slice(2)
if (!variant || !VARIANTS[variant]) { throw new Error(`usage: run-translate <${Object.keys(VARIANTS).join('|')}> [fr ja]`) }
mkdirSync(new URL('../results/', import.meta.url), { recursive: true })
for (const locale of (locales.length ? locales : ['fr', 'ja']) as Locale[]) {
  const t0 = Date.now()
  const result = await runTranslation(segments, { ...VARIANTS[variant]!, locale })
  writeFileSync(new URL(`../results/${prefix}${variant}${process.env.SUFFIX ?? ""}.${locale}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n')
  const errs = result.segments.filter(s => s.qa.some(q => q.check === 'placeholders')).length
  const cost = result.requests.reduce((a, r) => a + r.costUsd, 0)
  console.log(variant, locale, `${Date.now() - t0}ms`, 'placeholder-fail', errs, 'missing', result.segments.filter(s => s.target === null).length, 'requestErrors', result.requests.filter(r => r.error).length, `$${cost.toFixed(4)}`)
}
