import { readFileSync } from 'node:fs'
import process from 'node:process'
import { isPlaceholderOnly } from '@diglot/core'
import { loadGlossary, loadStyle } from '@diglot/store'
import { describe, expect, it } from 'vitest'
import { translateSegments } from '../src/index.ts'
import { segments } from './helpers.ts'

const live = process.env.AI_GATEWAY_API_KEY && process.env.DIGLOT_MT_MODEL
const example = new URL('../../../examples/nuxt/', import.meta.url).pathname

describe.skipIf(!live)('live translation', () => {
  it('should translate ten Nuxt segments to French through the QA gate', async () => {
    const source = readFileSync(new URL('../../../fixtures/nuxt/layers.md', import.meta.url), 'utf8')
    const input = (await segments(source, 'guide/going-further/layers.md'))
      .filter(s => s.format === 'markdown' && !isPlaceholderOnly(s.skeleton))
      .slice(0, 10)
    const result = await translateSegments(input, {
      locale: 'fr',
      glossary: await loadGlossary(example, 'fr', { shared: 'glossary.yml' }),
      style: await loadStyle(example, 'fr'),
      subject: 'the documentation of Nuxt, a Vue web framework',
      context: { title: 'Layers' },
    })
    const warnings = result.translations.flatMap(t => t.issues.map(i => `${t.hash} ${i.check}: ${i.message}`))
    process.stdout.write(`${JSON.stringify({ segments: input.length, ...result.usage, costPer1000: result.usage.costUsd && result.usage.costUsd / input.length * 1000, rejected: result.rejected, warnings, translations: result.translations.map(t => t.text) }, null, 2)}\n`)
    expect(result.rejected).toEqual([])
    expect(result.translations).toHaveLength(10)
  }, 120_000)
})
