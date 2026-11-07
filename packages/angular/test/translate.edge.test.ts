import type { TranslationRecord } from '@diglot/core'
import { extract as extractComark, parse } from '@diglot/comark'
import { createRecord, defaultPolicy } from '@diglot/core'
import { extract as extractMdast } from '@diglot/mdast'
import { parseBundle } from '@diglot/store/runtime'
import { describe, expect, it } from 'vitest'
import { translateMarkdown } from '../src/translate.ts'

const source = '---\ntitle: Welcome\n---\n\n# Getting started\n\nRead the [guide](/guide/) to get started.\n'
const french: Record<string, string> = {
  'Welcome': 'Bienvenue',
  'Getting started': 'Bien démarrer',
  'Read the {0}guide{/0} to get started.': 'Lisez le {0}guide{/0} pour commencer.',
}

describe('translateMarkdown at the edge', () => {
  it.each(['mdast', 'comark'] as const)('should apply a bundle with %s', async (parser) => {
    const segments = parser === 'comark' ? (await extractComark(await parse(source))).segments : await extractMdast(source)
    const records: Record<string, TranslationRecord> = Object.fromEntries(segments.map(segment => [segment.hash, createRecord({ segment, text: french[segment.skeleton]!, origin: 'human' })]))
    const bundle = parseBundle(JSON.stringify({ version: 1, locale: 'fr', records }))
    const { markdown, report } = await translateMarkdown(source, bundle, { parser, policy: defaultPolicy })
    expect(markdown).toContain('title: Bienvenue')
    expect(markdown).toContain('# Bien démarrer')
    expect(markdown).toContain('Lisez le [guide](/guide/) pour commencer.')
    expect(report).toEqual({ applied: 3, missing: 0, rejected: [] })
  })
})
