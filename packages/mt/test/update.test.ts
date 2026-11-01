import { describe, expect, it } from 'vitest'
import { updateTranslation, wordDiff } from '../src/update.ts'
import { mockModel, segment } from './helpers.ts'

describe('updateTranslation', () => {
  it('should carry the translation without a model call when the skeleton is unchanged', async () => {
    const before = await segment('Use [`useFetch`](/a) to fetch data.')
    const after = await segment('Use [`useAsyncData`](/b) to fetch data.')
    const result = await updateTranslation({ text: 'Utilisez {0} pour récupérer des données.' }, { previousSource: before, nextSource: after }, { locale: 'fr' })
    expect(result).toEqual({ status: 'ok', text: 'Utilisez {0} pour récupérer des données.', derived: 'carry', changedSentences: [], issues: [], usage: { requests: 0, inputTokens: 0, outputTokens: 0 } })
  })

  it('should send case and punctuation edits to the model', async () => {
    const after = await segment('See the [Guide](/guide), then use `useFetch`!')
    const { model, calls } = mockModel(() => ({ text: 'Consultez le {0}Guide{/0}, puis utilisez {1} !' }))
    const result = await updateTranslation({ text: 'Consultez le {0}guide{/0}, puis utilisez {1}.' }, { previousSource: 'See the {0}guide{/0}, then use {1}.', nextSource: after }, { locale: 'fr', model })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.user).toContain('See the [-{0}guide{/0},-] {+{0}Guide{/0},+} then use [-{1}.-] {+{1}!+}')
    expect(result).toMatchObject({ status: 'ok', derived: 'update', text: 'Consultez le {0}Guide{/0}, puis utilisez {1} !' })
  })

  it('should update from the word diff and the previous human text', async () => {
    const before = await segment('Read the [guide](/guide) and use `useFetch`.')
    const after = await segment('Read the [guide](/guide) and use `useFetch`. It also works with `$fetch`.')
    const { model, calls } = mockModel(() => ({ text: 'Lis le {0}guide{/0} et utilise {1}. Ça marche aussi avec {2}.' }), { cost: '0.004' })
    const glossary = { terms: [{ term: 'guide', decision: 'keep' as const }, { term: 'hydration', decision: 'translate' as const, target: 'hydratation' }] }
    const result = await updateTranslation({ text: 'Lis le {0}guide{/0} et utilise {1}.' }, { previousSource: before, nextSource: after }, { locale: 'fr', model, glossary })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.user).toContain('{+It also works with {2}.+}')
    expect(calls[0]!.user).toContain('Current translation (of the old source):\nLis le {0}guide{/0} et utilise {1}.')
    expect(calls[0]!.system).toContain('"guide": keep in English')
    expect(calls[0]!.system).not.toContain('hydration')
    expect(result).toEqual({
      status: 'ok',
      text: 'Lis le {0}guide{/0} et utilise {1}. Ça marche aussi avec {2}.',
      derived: 'update',
      changedSentences: ['Ça marche aussi avec {2}.'],
      issues: [],
      mt: { model: 'mock/model', promptVersion: '1', candidate: 'Lis le {0}guide{/0} et utilise {1}. Ça marche aussi avec {2}.' },
      usage: { requests: 1, inputTokens: 100, outputTokens: 20, costUsd: 0.004 },
    })
  })

  it('should send the previous translation renumbered to the new placeholders', async () => {
    const before = await segment('Read the [guide](/guide) and use `useFetch`.')
    const after = await segment('Use `$fetch` or read the [guide](/guide) and use `useFetch`.')
    const { model, calls } = mockModel(() => ({ text: 'Utilisez {0} ou lisez le {1}guide{/1} et utilisez {2}.' }))
    const result = await updateTranslation({ text: 'Lisez le {0}guide{/0} et utilisez {1}.' }, { previousSource: before, nextSource: after }, { locale: 'fr', model })
    expect(calls[0]!.user).toContain('Current translation (of the old source):\nLisez le {1}guide{/1} et utilisez {2}.')
    expect(result).toMatchObject({ status: 'ok', derived: 'update' })
  })

  it('should apply typography to changed sentences only', async () => {
    const before = await segment('Note: use `a`.')
    const after = await segment('Note: use `a`. Warning: it is fast.')
    const { model } = mockModel(() => ({ text: 'Remarque: utilisez {0}. Attention: c\'est rapide.' }))
    const result = await updateTranslation({ text: 'Remarque: utilisez {0}.' }, { previousSource: before, nextSource: after }, { locale: 'fr', model, style: { typography: { spaceBefore: ':' } } })
    expect(result).toMatchObject({ text: 'Remarque: utilisez {0}. Attention\u202F: c\'est rapide.' })
  })

  it('should retry once and reject an update that keeps failing QA', async () => {
    const before = await segment('Use `a` to fetch data.')
    const after = await segment('Use `a` to fetch remote data.')
    const { model, calls } = mockModel(() => ({ text: 'Utilisez pour récupérer des données distantes.' }))
    const result = await updateTranslation({ text: 'Utilisez {0} pour récupérer des données.' }, { previousSource: before, nextSource: after }, { locale: 'fr', model })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.user).toContain('Your previous update failed automatic checks:\nUtilisez pour récupérer des données distantes.\n\nProblems:\n- {0} is missing')
    expect(result).toMatchObject({ status: 'rejected', output: 'Utilisez pour récupérer des données distantes.', usage: { requests: 2 } })
  })
})

describe('wordDiff', () => {
  it('should mark removed and added words', () => {
    expect(wordDiff('Your desired variables must be defined in {0}.', 'Custom runtime config variables must be defined in {0}.')).toBe('[-Your desired-] {+Custom runtime config+} variables must be defined in {0}.')
  })
})
