import type { TranslationRecord } from '@diglot/core'
import { describe, expect, it } from 'vitest'
import { decodeRecords, encodeRecords } from '../src/runtime.ts'

const at = '2026-11-01T00:00:00.000Z'
const records: TranslationRecord[] = [
  { hash: '1d4e5186ed79d236', source: 'Hello', text: 'Bonjour', origin: 'mt', review: 'none', derived: 'fresh', mt: { model: 'm', candidate: 'Bonjour' }, updatedAt: at },
  { hash: '2a4e5186ed79d236', source: 'Hello {0}', text: 'Salut {0}', origin: 'human', review: 'verified', derived: 'update', prev: '1d4e5186ed79d236', salt: 's', mt: { model: 'm', promptVersion: '2', candidate: '' }, by: 'a', verifiedBy: { by: 'b', at }, updatedAt: '2026-11-02T00:00:00.000Z' },
  { hash: '3a4e5186ed79d236', source: 'Bye', text: 'Au revoir', origin: 'tm', review: 'rejected', derived: 'carry', prev: '2a4e5186ed79d236', rejectedBy: { by: 'c', at }, updatedAt: at },
  { hash: '4a4e5186ed79d236', source: 'Yes', text: 'Oui', origin: 'mt', review: 'edited', derived: 'fresh', mt: { model: 'n', candidate: 'Si' }, by: 'a', updatedAt: at },
]

describe('encodeRecords', () => {
  it('should round-trip every field', async () => {
    const input = Object.fromEntries(records.map(record => [record.hash, record]))
    for (const [compression, prefix] of [['gzip', 'H4sI'], ['zstd', 'KLUv'], ['none', '{']] as const) {
      const data = await encodeRecords(input, { compression })
      expect(data.startsWith(prefix)).toBe(true)
      const decoded = await decodeRecords(data)
      expect([...decoded.keys()]).toEqual(records.map(record => record.hash))
      for (const record of records)
        expect(JSON.stringify(decoded.get(record.hash))).toBe(JSON.stringify(record))
    }
  })

  it('should round-trip each record on its own', async () => {
    for (const record of records)
      expect(JSON.stringify((await decodeRecords(await encodeRecords({ [record.hash]: record }))).get(record.hash))).toBe(JSON.stringify(record))
  })

  it('should leave out invalid records and records under another hash', async () => {
    const decoded = await decodeRecords(await encodeRecords(new Map<string, unknown>([
      ['1d4e5186ed79d236', records[0]],
      ['ffffffffffffffff', records[3]],
      ['2a4e5186ed79d236', { ...records[1], review: 'unknown' }],
    ])))
    expect([...decoded.keys()]).toEqual(['1d4e5186ed79d236'])
  })

  it('should be smaller than the JSON of the records', async () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => {
      const hash = i.toString(16).padStart(16, '0')
      return [hash, { ...records[0], hash, source: `Hello ${i}`, text: `Bonjour ${i}`, mt: { model: 'model', candidate: `Bonjour ${i}` } }]
    }))
    expect((await encodeRecords(many, { compression: 'none' })).length).toBeLessThan(JSON.stringify(many).length / 2)
  })

  it('should reject other data', async () => {
    await expect(decodeRecords('{"version":1}')).rejects.toThrow('unsupported records pack')
    await expect(decodeRecords(`{"version":2,"strings":[],"columns":[${'[],'.repeat(14)}[]]}`)).rejects.toThrow('unsupported records pack')
    await expect(decodeRecords(`{"version":1,"strings":[],"columns":[[1]${',[]'.repeat(14)}]}`)).rejects.toThrow('malformed records pack')
  })
})
