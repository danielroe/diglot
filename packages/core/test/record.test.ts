import type { TranslationRecord } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { createRecord, editRatio, matchGlossary, normaliseRecord, parseRecord, RecordError, recordStatus } from '../src/index.ts'

const base: TranslationRecord = {
  hash: '1d4e5186ed79d236',
  source: 'Nuxt is powered by {0}Nitro{/0}.',
  text: 'Nuxt est propulsé par {0}Nitro{/0}.',
  origin: 'mt',
  review: 'none',
  derived: 'fresh',
  updatedAt: '2026-11-01T00:00:00.000Z',
}
const segment = { kind: 'paragraph' as const, format: 'markdown' as const, placeholders: [{ id: 0, type: 'link' as const, source: '[', close: '](https://nitro.build)' }] }

describe('records', () => {
  it('should parse a valid record and reject malformed ones', () => {
    expect(parseRecord(base)).toEqual(base)
    expect(() => parseRecord({ ...base, extra: 1 })).toThrow(RecordError)
    expect(() => parseRecord({ ...base, hash: 'nothex' })).toThrow('"hash"')
    expect(() => parseRecord({ ...base, origin: 'robot' })).toThrow('"origin"')
    expect(() => parseRecord({ ...base, derived: 'update' })).toThrow('"prev"')
    expect(() => parseRecord({ ...base, review: 'verified' })).toThrow('"verifiedBy"')
    expect(() => parseRecord({ ...base, mt: { model: 'x' } })).toThrow('"mt"')
  })

  it('should normalise key order and drop undefined fields', () => {
    const shuffled = { updatedAt: base.updatedAt, text: base.text, hash: base.hash, by: undefined, source: base.source, derived: base.derived, review: base.review, origin: base.origin, mt: { candidate: 'c', model: 'm' } }
    expect(Object.keys(normaliseRecord(shuffled))).toEqual(['hash', 'source', 'text', 'origin', 'review', 'derived', 'mt', 'updatedAt'])
    expect(Object.keys(normaliseRecord(shuffled).mt!)).toEqual(['model', 'candidate'])
  })

  it('should create records from segments', () => {
    const record = createRecord({ segment: { hash: base.hash, skeleton: base.source, salt: 'ctx' }, text: base.text, origin: 'mt', prev: 'aaaaaaaaaaaaaaaa', updatedAt: base.updatedAt })
    expect(record).toEqual({ ...base, derived: 'update', prev: 'aaaaaaaaaaaaaaaa', salt: 'ctx' })
  })

  it('should derive reader status', () => {
    expect(recordStatus(undefined)).toBe('untranslated')
    expect(recordStatus(base, segment)).toBe('machine')
    expect(recordStatus({ ...base, derived: 'update', prev: 'x' })).toBe('pending-review')
    expect(recordStatus({ ...base, derived: 'carry', prev: 'x' })).toBe('pending-review')
    expect(recordStatus({ ...base, origin: 'human' })).toBe('edited')
    expect(recordStatus({ ...base, origin: 'human', derived: 'carry', prev: 'x' })).toBe('pending-review')
    expect(recordStatus({ ...base, review: 'edited', derived: 'update', prev: 'x' })).toBe('edited')
    expect(recordStatus({ ...base, review: 'verified', verifiedBy: { by: 'danielroe', at: base.updatedAt } })).toBe('verified')
    expect(recordStatus({ ...base, text: 'Nuxt [x](https://evil)' }, segment)).toBe('rejected')
  })

  it('should measure how much of the machine candidate was edited', () => {
    expect(editRatio(base)).toBeUndefined()
    expect(editRatio({ ...base, mt: { model: 'm', candidate: base.text } })).toBe(0)
    expect(editRatio({ text: 'abcd', mt: { model: 'm', candidate: 'abcx' } })).toBe(0.25)
  })
})

describe('matchGlossary', () => {
  it('should match terms outside placeholders', () => {
    const glossary = { terms: [
      { term: 'layer', match: '\\blayers?\\b', decision: 'keep-gloss' as const, gloss: 'couche' },
      { term: 'Nitro', decision: 'keep' as const },
      { term: 'composable', decision: 'translate' as const, target: 'コンポーザブル' },
    ] }
    expect(matchGlossary(glossary, 'Layers extend {0}Nitro{/0}').map(e => e.term)).toEqual(['layer', 'Nitro'])
    expect(matchGlossary(glossary, 'composables{0}')).toEqual([])
  })

  it('should match case-sensitively when asked', () => {
    const glossary = { terms: [{ term: 'Vue', decision: 'keep' as const, caseSensitive: true }] }
    expect(matchGlossary(glossary, 'Vue components')).toHaveLength(1)
    expect(matchGlossary(glossary, 'the vue of the city')).toEqual([])
  })
})
