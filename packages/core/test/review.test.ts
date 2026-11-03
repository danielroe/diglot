import type { TranslationRecord } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { editRecord, parseRecord, rejectRecord, verifyRecord } from '../src/index.ts'

const segment = {
  hash: '1d4e5186ed79d236',
  skeleton: 'Nuxt is powered by {0}Nitro{/0}.',
  kind: 'paragraph' as const,
  format: 'markdown' as const,
  placeholders: [{ id: 0, type: 'link' as const, source: '[', close: '](https://nitro.build)' }],
}
const at = '2026-11-02T00:00:00.000Z'
const machine: TranslationRecord = {
  hash: segment.hash,
  source: segment.skeleton,
  text: 'Nuxt est propulsé par {0}Nitro{/0}.',
  origin: 'mt',
  review: 'none',
  derived: 'update',
  prev: 'aaaaaaaaaaaaaaaa',
  mt: { model: 'm', candidate: 'Nuxt est propulsé par {0}Nitro{/0}.' },
  updatedAt: '2026-11-01T00:00:00.000Z',
}
const verified: TranslationRecord = { ...machine, review: 'verified', verifiedBy: { by: 'atinux', at } }
const rejected: TranslationRecord = { ...machine, review: 'rejected', rejectedBy: { by: 'atinux', at } }

describe('editRecord', () => {
  it('should create a human edit that keeps the machine candidate and lineage', () => {
    const result = editRecord(verified, { segment, text: 'Nuxt repose sur {0}Nitro{/0}.', by: 'danielroe', at })
    expect(result).toEqual({ ok: true, warnings: [], record: { ...machine, text: 'Nuxt repose sur {0}Nitro{/0}.', origin: 'human', review: 'edited', by: 'danielroe', updatedAt: at } })
    expect(parseRecord(result.ok && result.record)).toBeTruthy()
  })

  it('should create a fresh record for an untranslated segment', () => {
    expect(editRecord(undefined, { segment, text: 'Nuxt repose sur {0}Nitro{/0}.', by: 'danielroe', at, expected: null })).toMatchObject({ ok: true, record: { hash: segment.hash, derived: 'fresh', origin: 'human', review: 'edited' } })
  })

  it('should refuse invalid, unchanged and stale edits', () => {
    expect(editRecord(machine, { segment, text: 'Nuxt `x`.', by: 'danielroe' })).toMatchObject({ ok: false, code: 'invalid', errors: [{ code: 'inline-code' }, { code: 'inline-code' }, { code: 'missing-placeholder' }] })
    expect(editRecord(machine, { segment, text: machine.text, by: 'danielroe' })).toMatchObject({ ok: false, code: 'unchanged' })
    expect(editRecord(machine, { segment, text: 'Nuxt repose sur {0}Nitro{/0}.', by: 'danielroe', expected: 'something else' })).toMatchObject({ ok: false, code: 'stale' })
    expect(editRecord(machine, { segment, text: 'Nuxt repose sur {0}Nitro{/0}.', by: 'danielroe', expected: null })).toMatchObject({ ok: false, code: 'stale' })
    expect(editRecord(undefined, { segment, text: 'Nuxt repose sur {0}Nitro{/0}.', by: 'danielroe', expected: machine.text })).toMatchObject({ ok: false, code: 'stale' })
  })

  it('should replace a rejection with the same text', () => {
    const result = editRecord(rejected, { segment, text: rejected.text, by: 'danielroe', at, expected: rejected.text })
    expect(result).toMatchObject({ ok: true, record: { review: 'edited' } })
    expect(result.ok && result.record.rejectedBy).toBeUndefined()
  })
})

describe('verifyRecord', () => {
  it('should verify the current text', () => {
    expect(verifyRecord(machine, { segment, by: 'danielroe', at, expected: machine.text })).toEqual({ ok: true, warnings: [], record: { ...machine, review: 'verified', verifiedBy: { by: 'danielroe', at }, updatedAt: at } })
  })

  it('should refuse missing, stale, rejected, invalid and verified records', () => {
    expect(verifyRecord(undefined, { by: 'danielroe' })).toMatchObject({ ok: false, code: 'no-record' })
    expect(verifyRecord(machine, { by: 'danielroe', expected: 'older text' })).toMatchObject({ ok: false, code: 'stale' })
    expect(verifyRecord(rejected, { by: 'danielroe', expected: rejected.text })).toMatchObject({ ok: false, code: 'rejected' })
    expect(verifyRecord({ ...machine, text: 'Nuxt' }, { segment, by: 'danielroe' })).toMatchObject({ ok: false, code: 'invalid', errors: [{ code: 'missing-placeholder' }] })
    expect(verifyRecord({ ...machine, text: 'Nuxt' }, { by: 'danielroe' })).toMatchObject({ ok: true })
    expect(verifyRecord(verified, { segment, by: 'danielroe' })).toMatchObject({ ok: false, code: 'unchanged' })
  })
})

describe('rejectRecord', () => {
  it('should reject a record and drop its verification', () => {
    expect(rejectRecord(verified, { by: 'danielroe', at, expected: verified.text })).toEqual({ ok: true, warnings: [], record: { ...machine, review: 'rejected', rejectedBy: { by: 'danielroe', at }, updatedAt: at } })
  })

  it('should refuse missing, stale and rejected records', () => {
    expect(rejectRecord(undefined, { by: 'danielroe' })).toMatchObject({ ok: false, code: 'no-record' })
    expect(rejectRecord(machine, { by: 'danielroe', expected: 'older text' })).toMatchObject({ ok: false, code: 'stale' })
    expect(rejectRecord(rejected, { by: 'danielroe' })).toMatchObject({ ok: false, code: 'unchanged' })
  })
})
