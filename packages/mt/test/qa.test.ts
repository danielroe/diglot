import type { Glossary } from '@diglot/core'
import type { QaCheck } from '../src/types.ts'
import { describe, expect, it } from 'vitest'
import { runQa } from '../src/qa.ts'
import { applyTypography } from '../src/typography.ts'
import { segment } from './helpers.ts'

const PARAGRAPH = 'Use [`useFetch`](/docs/api/composables/use-fetch) in Nuxt v3.12.0 to fetch **data** from the [server](/docs/guide/server). Call `useFetch` again or `$fetch`.'
const GOOD = 'Utilisez {0} dans Nuxt v3.12.0 pour récupérer des **données** depuis le {1}serveur{/1}. Appelez à nouveau {2} ou {3}.'

const glossary: Glossary = { terms: [
  { term: 'Nuxt', decision: 'keep' },
  { term: 'composable', decision: 'keep' },
  { term: 'server', decision: 'translate', target: 'serveur' },
  { term: 'layer', match: '\\blayers?\\b', decision: 'keep-gloss', gloss: 'couche' },
] }

async function flags(source: string, translation: string, locale = 'fr', severity: 'error' | 'warning' = 'error'): Promise<QaCheck[]> {
  const issues = runQa(translation, await segment(source), { locale, glossary })
  return [...new Set(issues.filter(i => i.severity === severity).map(i => i.check))]
}

describe('runQa', () => {
  it('should pass a clean translation', async () => {
    expect(runQa(GOOD, await segment(PARAGRAPH), { locale: 'fr', glossary })).toEqual([])
  })

  it('should reject markup that the grammar does not allow', async () => {
    expect(await flags(PARAGRAPH, GOOD.replace('{1}serveur{/1}', '[serveur](https://example.com)'))).toEqual(['grammar', 'placeholders'])
  })

  it('should reject missing, invented and lookalike placeholders', async () => {
    expect(await flags(PARAGRAPH, GOOD.replace(' ou {3}', ''))).toContain('placeholders')
    expect(await flags(PARAGRAPH, `${GOOD} {4}`)).toContain('placeholders')
    expect(await flags(PARAGRAPH, GOOD.replace('{3}', '{3} ｛3｝'))).toEqual(['placeholders'])
  })

  it('should only warn about repeated code placeholders', async () => {
    const source = 'With `await`, execution pauses until the data is ready.'
    const ja = '{0} を使用すると、{0} によりデータの準備ができるまで実行が一時停止します。'
    expect(await flags(source, ja, 'ja')).toEqual([])
    expect(await flags(source, ja, 'ja', 'warning')).toEqual(['placeholders'])
  })

  it('should flag untranslated output', async () => {
    expect(await flags(PARAGRAPH, 'Use {0} in Nuxt v3.12.0 to fetch **data** from the {1}server{/1}. Call {2} again or {3}.')).toContain('untranslated')
    expect(await flags('Server routes', 'Server routes')).toEqual([])
    expect(await flags('Nr.&nbsp;5 Such&shy;maschine', 'Nr.&nbsp;5 Such&shy;maschine')).toEqual([])
  })

  it('should warn about length outliers', async () => {
    expect(await flags(PARAGRAPH, 'Utilisez {0} v3.12.0 **ok** {1}a{/1} {2} {3}.', 'fr', 'warning')).toContain('length-ratio')
  })

  it('should reject leaked instructions', async () => {
    expect(await flags(PARAGRAPH, `Voici la traduction : ${GOOD}`)).toContain('leaked-instructions')
  })

  it('should reject heading markers in headings', async () => {
    expect(await flags('## The need for `useFetch`', '## Pourquoi utiliser {0}')).toContain('structure')
  })

  it('should require version strings and warn about small numbers', async () => {
    expect(await flags(PARAGRAPH, GOOD.replace('v3.12.0', 'v3.12'))).toEqual(['numbers'])
    expect(await flags('There are 3 ways to fetch data in your application.', 'Il existe trois façons de récupérer des données dans votre application.', 'fr', 'warning')).toEqual(['numbers'])
  })

  it('should reject emphasis that would not parse next to CJK text', async () => {
    const source = 'It decides whether the link is _internal_ or _external_.'
    expect(await flags(source, 'リンクが_内部_か_外部_かを判断します。', 'ja')).toEqual(['emphasis'])
    expect(await flags(source, 'リンクが*内部*か*外部*かを判断します。', 'ja')).toEqual([])
    expect(await flags('This is **really** important.', 'これは**「本当に」**重要です。', 'ja')).toEqual(['emphasis'])
    expect(await flags('This is **really** important.', 'これは**本当に**重要です。', 'ja')).toEqual([])
  })

  it('should warn when glossary decisions are not followed', async () => {
    expect(await flags('Layers extend the server.', 'Les couches étendent le serveur.', 'fr', 'warning')).toEqual(['glossary'])
    expect(await flags('Layers extend the server.', 'Les layers (couches) étendent le back-end.', 'fr', 'warning')).toEqual(['glossary'])
    expect(await flags('Layers extend the server.', 'Les layers (couches) étendent le serveur.', 'fr', 'warning')).toEqual([])
    expect(await flags('Create a composable library.', 'Créez une bibliothèque de composables.', 'fr', 'warning')).toEqual([])
  })

  it('should skip markup checks for plain segments', async () => {
    const plain = { hash: 'x', kind: 'frontmatter' as const, format: 'plain' as const, skeleton: 'Data fetching', placeholders: [] }
    expect(runQa('Récupération de données', plain, { locale: 'fr' })).toEqual([])
    expect(runQa('**Récupération** de données', plain, { locale: 'fr' }).map(i => i.check)).toEqual(['grammar'])
  })
})

describe('applyTypography', () => {
  const french = { spaceBefore: ';:!?»', spaceAfter: '«' }

  it('should insert narrow no-break spaces in French punctuation', () => {
    expect(applyTypography('Note: voici « mot », vraiment?! {0}: valeur', french)).toBe('Note\u202F: voici «\u202Fmot\u202F», vraiment\u202F?! {0}\u202F: valeur')
    expect(applyTypography('Note : voici', french)).toBe('Note\u202F: voici')
  })

  it('should leave times, escapes and unconfigured locales alone', () => {
    expect(applyTypography('à 10:30, a\\: b', french)).toBe('à 10:30, a\\: b')
    expect(applyTypography('Note: voici', undefined)).toBe('Note: voici')
    expect(applyTypography('Bravo&nbsp;! Such&shy; und', french)).toBe('Bravo&nbsp;! Such&shy; und')
  })
})
