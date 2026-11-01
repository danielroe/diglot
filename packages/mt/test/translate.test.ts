import type { Glossary } from '@diglot/core'
import { describe, expect, it, vi } from 'vitest'
import { translateSegments } from '../src/index.ts'
import { mockModel, requested, segments } from './helpers.ts'

const FRENCH: Record<string, string> = {
  'Data fetching': 'Récupération de données',
  'Use {0} in a {1}page{/1}.': 'Utilisez {0} dans une {1}page{/1}.',
  'Call {0} twice: {0}.': 'Appelez {0} deux fois : {0}.',
  'Layers extend Nuxt.': 'Les layers (couches) étendent Nuxt.',
  'Hello world': 'Bonjour le monde',
}

function french(text: string): string {
  return FRENCH[text] ?? `FR ${text}`
}

const glossary: Glossary = {
  terms: [
    { term: 'Nuxt', decision: 'keep' },
    { term: 'layer', match: '\\blayers?\\b', decision: 'keep-gloss', gloss: 'couche' },
    { term: 'hydration', decision: 'translate', target: 'hydratation' },
  ],
  style: ['Address the reader as "vous".'],
}

describe('translateSegments', () => {
  it('should batch by page, dedupe segments and placeholders, and account for usage', async () => {
    const page = await segments('# Data fetching\n\nUse `useFetch` in a [page](/p).\n\nCall `x` twice: `x`.\n\n# Data fetching\n', 'a.md')
    const other = await segments('Layers extend Nuxt.\n\n`{{ only }}`\n', 'b.md')
    const { model, calls } = mockModel(call => ({ translations: requested(call).map(s => ({ id: s.id, text: french(s.text) })) }), { cost: '0.0015' })
    const result = await translateSegments([...page, ...other], { locale: 'fr', model, glossary, style: { rules: ['Use sentence case in headings.'], typography: { spaceBefore: ':' } }, context: file => ({ title: file }) })

    expect(calls).toHaveLength(2)
    expect(requested(calls[0]!)).toEqual([
      { id: 's1', kind: 'heading', text: 'Data fetching' },
      { id: 's2', kind: 'paragraph', text: 'Use {0} in a {1}page{/1}.' },
      { id: 's3', kind: 'paragraph', text: 'Call {0} twice: {0}.' },
    ])
    expect(calls[0]!.user).toContain('- Page title: a.md')
    expect(calls[0]!.system).toContain('into French')
    expect(calls[0]!.system).toContain('Address the reader as "vous".')
    expect(calls[0]!.system).toContain('Use sentence case in headings.')
    expect(calls[0]!.system).not.toContain('"layer"')
    expect(calls[1]!.system).toContain('"layer": keep in English; on its first use in a page add the gloss in parentheses: "layer (couche)"')
    expect(calls[1]!.system).not.toContain('hydration')

    expect(result.translations.map(t => [t.text, t.derived])).toEqual([
      ['Récupération de données', 'fresh'],
      ['Utilisez {0} dans une {1}page{/1}.', 'fresh'],
      ['Appelez {0} deux fois\u202F: {1}.', 'fresh'],
      ['Les layers (couches) étendent Nuxt.', 'fresh'],
    ])
    expect(result.translations[0]!.mt).toEqual({ model: 'mock/model', promptVersion: '1', candidate: 'Récupération de données' })
    expect(result.rejected).toEqual([])
    expect(result.usage).toEqual({ requests: 2, inputTokens: 200, outputTokens: 40, costUsd: 0.003 })
  })

  it('should retry segments that fail QA with the problems listed, then accept them', async () => {
    const input = await segments('Use `useFetch` in a [page](/p).\n\nHello world\n')
    const { model, calls } = mockModel((call, i) => ({
      translations: requested(call).map(s => ({ id: s.id, text: i === 0 && s.id === 's1' ? 'Utilisez dans une page.' : french(s.text) })),
    }), { cost: '0.001' })
    const result = await translateSegments(input, { locale: 'fr', model })

    expect(calls).toHaveLength(2)
    const retry = requested(calls[1]!)
    expect(retry).toEqual([{ id: 's1', kind: 'paragraph', text: 'Use {0} in a {1}page{/1}.', previous: 'Utilisez dans une page.', problems: ['{0} is missing', '{1} is missing'] }])
    expect(calls[1]!.user).toContain('failed automatic checks')
    expect(result.translations.map(t => t.text)).toEqual(['Utilisez {0} dans une {1}page{/1}.', 'Bonjour le monde'])
    expect(result.usage.requests).toBe(2)
  })

  it('should reject segments that still fail after the retries and report why', async () => {
    const input = await segments('Use `useFetch` in a [page](/p).\n\nHello world\n')
    const { model, calls } = mockModel(call => ({ translations: requested(call).filter(s => s.id !== 's2').map(s => ({ id: s.id, text: s.id === 's1' ? '[page](https://evil.example) {0}' : french(s.text) })) }))
    const result = await translateSegments(input, { locale: 'fr', model, qaRetries: 1 })

    expect(calls).toHaveLength(2)
    expect(result.translations).toEqual([])
    expect(result.rejected.map(r => [r.hash, r.output, r.issues.map(i => i.check)])).toEqual([
      [input[0]!.hash, '[page](https://evil.example) {0}', ['grammar', 'grammar', 'grammar', 'placeholders']],
      [input[1]!.hash, undefined, ['response']],
    ])
    expect(result.usage.costUsd).toBeUndefined()
  })

  it('should treat output that does not match the schema as missing', async () => {
    const input = await segments('Hello world\n')
    const { model, calls } = mockModel((call, i) => i === 0 ? 'not json' : { translations: requested(call).map(s => ({ id: s.id, text: french(s.text) })) })
    const result = await translateSegments(input, { locale: 'fr', model, pricing: { input: 2, output: 10 } })
    expect(calls).toHaveLength(2)
    expect(result.translations.map(t => t.text)).toEqual(['Bonjour le monde'])
    expect(result.usage).toEqual({ requests: 2, inputTokens: 200, outputTokens: 40, costUsd: 0.0008 })
  })

  it('should split pages by batch size and skip segments without text', async () => {
    const input = await segments(Array.from({ length: 5 }, (_, i) => `Paragraph number ${i + 1}.`).join('\n\n'))
    const { model, calls } = mockModel(call => ({ translations: requested(call).map(s => ({ id: s.id, text: `Paragraphe numéro ${/\d/.exec(s.text)![0]}.` })) }))
    const result = await translateSegments(input, { locale: 'fr', model, batch: 2 })
    expect(calls.map(c => requested(c).length)).toEqual([2, 2, 1])
    expect(result.translations).toHaveLength(5)
    expect(await translateSegments(await segments('`a`\n\n[`b`](/b)\n'), { locale: 'fr', model })).toEqual({ translations: [], rejected: [], usage: { requests: 0, inputTokens: 0, outputTokens: 0 } })
    expect(calls).toHaveLength(3)
  })

  it('should require a model', async () => {
    vi.stubEnv('DIGLOT_MT_MODEL', '')
    await expect(translateSegments([], { locale: 'fr' })).rejects.toThrow('DIGLOT_MT_MODEL')
  })
})
