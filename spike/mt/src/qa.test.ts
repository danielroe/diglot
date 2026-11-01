import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mask, unmask } from './placeholders.ts'
import { runQa, type QaCheck } from './qa.ts'
import type { Locale } from './glossary.ts'

function flags (source: string, targetMasked: string, locale: Locale = 'fr'): Set<QaCheck> {
  const m = mask(source)
  const target = unmask(targetMasked, m.tokens)
  return new Set(runQa({ locale, sourceMasked: m.masked, targetMasked, tokens: m.tokens, source, target }).filter(q => q.severity === 'error' || q.check !== 'placeholders').map(q => q.check))
}

const src = 'Use [`useFetch`](/docs/api/composables/use-fetch) in Nuxt v3.12.0 to fetch **data** from the server.'

test('clean output passes', () => {
  assert.deepEqual(flags(src, 'Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données** depuis le serveur.'), new Set())
})

test('placeholders', () => {
  assert.ok(flags(src, 'Utilisez [{0}]() dans Nuxt v3.12.0 pour récupérer des **données** depuis le serveur.').has('placeholders'))
  assert.ok(flags(src, 'Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données** {2} depuis le serveur.').has('placeholders'))
  assert.ok(flags(src, 'Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données** ｛1｝ depuis le serveur.').has('placeholders'))
  assert.ok(flags(src, 'Utilisez [{0}]({1}) [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données**.').has('placeholders'))
})

test('repeated code placeholder is only a warning', () => {
  const s = 'With `await`, execution pauses.'
  assert.ok(!flags(s, '{0} を使用すると、{0} の実行が一時停止します。', 'ja').has('placeholders'))
})

test('untranslated', () => {
  assert.ok(flags(src, 'Use [{0}]({1}) in Nuxt v3.12.0 to fetch **data** from the server.').has('untranslated'))
})

test('length ratio', () => {
  assert.ok(flags(src, 'Utilisez [{0}]({1}) v3.12.0 **ok**.').has('length-ratio'))
})

test('leaked instructions', () => {
  assert.ok(flags(src, 'Voici la traduction : Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données**.').has('leaked-instructions'))
})

test('markdown structure', () => {
  assert.ok(flags(src, 'Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données depuis le serveur.').has('markdown-structure'))
  assert.ok(flags('It decides whether the link is _internal_ or _external_.', 'リンクが_内部_か_外部_かを判断します。', 'ja').has('markdown-structure'))
})

test('block type', () => {
  assert.ok(flags(src, '## Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données** depuis le serveur.').has('block-type'))
  assert.ok(flags(src, '- Utilisez [{0}]({1}) dans Nuxt v3.12.0 pour récupérer des **données** depuis le serveur.').has('block-type'))
})

test('numbers', () => {
  assert.ok(flags(src, 'Utilisez [{0}]({1}) dans Nuxt v3.12 pour récupérer des **données** depuis le serveur.').has('numbers'))
})
