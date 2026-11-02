import type { Translations } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { buildSegment, createRecord, createSegmentEvent, resolveTranslation, wordsByStatus } from '../src/index.ts'

const segment = (text: string) => buildSegment({ kind: 'paragraph', content: [{ type: 'text', value: text }], context: { headingTrail: [], containers: [] }, position: { startLine: 1, endLine: 1, precision: 'file' } }, { file: 'a.md', index: 0 })!

describe('createSegmentEvent', () => {
  it('should derive outcome and status from records and bare skeletons', () => {
    const source = segment('Three words here')
    const record = createRecord({ segment: source, text: 'Trois mots ici', origin: 'mt' })
    const event = (translations: Translations) => createSegmentEvent(source, resolveTranslation(source, translations), null)
    expect(event(new Map([[source.hash, record]]))).toEqual({ segment: source, target: null, record, outcome: 'translated', errors: [], status: 'machine' })
    expect(event(new Map([[source.hash, 'Trois mots ici']]))).toEqual({ segment: source, target: null, outcome: 'translated', errors: [] })
    expect(event(new Map([[source.hash, { ...record, text: '' }]]))).toMatchObject({ outcome: 'rejected', status: 'rejected', errors: [{ code: 'empty' }] })
    expect(event(new Map())).toMatchObject({ outcome: 'missing', status: 'untranslated' })
  })
})

describe('wordsByStatus', () => {
  it('should sum words by status', () => {
    const a = segment('Three words here')
    const b = segment('Two words')
    const events = [
      createSegmentEvent(a, resolveTranslation(a, new Map([[a.hash, createRecord({ segment: a, text: 'Trois mots ici', origin: 'human' })]])), null),
      createSegmentEvent(b, resolveTranslation(b, new Map()), null),
      createSegmentEvent(b, resolveTranslation(b, new Map([[b.hash, 'Deux mots']])), null),
    ]
    expect(wordsByStatus(events)).toEqual({ edited: 3, untranslated: 2 })
  })
})
