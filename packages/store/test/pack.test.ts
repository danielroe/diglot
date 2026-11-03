import type { TranslationRecord } from '@diglot/core'
import { describe, expect, it } from 'vitest'
import { decodeRecords, decodeRecordsView, encodeRecords } from '../src/runtime.ts'

const at = '2026-11-01T00:00:00.000Z'
const records: TranslationRecord[] = [
  { hash: '1d4e5186ed79d236', source: 'Hello', text: 'Bonjour', origin: 'mt', review: 'none', derived: 'fresh', mt: { model: 'm', candidate: 'Bonjour' }, updatedAt: at },
  { hash: '2a4e5186ed79d236', source: 'Hello {0}', text: 'Salut {0}', origin: 'human', review: 'verified', derived: 'update', prev: '1d4e5186ed79d236', salt: 's', mt: { model: 'm', promptVersion: '2', candidate: '' }, by: 'a', verifiedBy: { by: 'b', at }, updatedAt: '2026-11-02T00:00:00.000Z' },
  { hash: '3a4e5186ed79d236', source: 'Bye', text: 'Au revoir', origin: 'tm', review: 'rejected', derived: 'carry', prev: '2a4e5186ed79d236', rejectedBy: { by: 'c', at }, updatedAt: at },
  { hash: '4a4e5186ed79d236', source: 'Yes', text: 'Oui', origin: 'mt', review: 'edited', derived: 'fresh', mt: { model: 'n', candidate: 'Si' }, by: 'a', updatedAt: at },
  { hash: '5a4e5186ed79d236', source: 'No', text: 'Non', origin: 'human', review: 'rejected', derived: 'update', prev: '4a4e5186ed79d236', salt: 't', mt: { model: 'n', promptVersion: '3', candidate: 'Pas' }, by: 'd', verifiedBy: { by: 'b', at }, rejectedBy: { by: 'c', at: '2026-11-03T00:00:00.000Z' }, updatedAt: at },
  { hash: '6a4e5186ed79d236', source: 'Maybe', text: 'Peut-être', origin: 'tm', review: 'none', derived: 'fresh', updatedAt: at },
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

describe('decodeRecordsView', () => {
  const packs = [records, ...records.map(record => [record])]

  it('should read the same records as decodeRecords', async () => {
    for (const compression of ['gzip', 'zstd', 'none'] as const) {
      for (const pack of packs) {
        const data = await encodeRecords(Object.fromEntries(pack.map(record => [record.hash, record])), { compression })
        const map = await decodeRecords(data)
        const view = await decodeRecordsView(data)
        expect(view.size).toBe(map.size)
        expect([...view.keys()]).toEqual([...map.keys()])
        for (const record of pack) {
          expect(view.has(record.hash)).toBe(true)
          expect(view.get(record.hash)).toEqual(map.get(record.hash))
          expect(JSON.stringify(view.get(record.hash))).toBe(JSON.stringify(record))
        }
        expect(JSON.stringify([...view])).toBe(JSON.stringify([...map]))
      }
    }
  })

  it('should build each record once', async () => {
    const view = await decodeRecordsView(await encodeRecords(Object.fromEntries(records.map(record => [record.hash, record]))))
    const first = view.get(records[1]!.hash)
    expect(view.get(records[1]!.hash)).toBe(first)
    expect([...view.values()][1]).toBe(first)
    expect([...view.entries()][1]![1]).toBe(first)
    const seen: unknown[] = []
    view.forEach((value, key, map) => seen.push([value, key, map]))
    expect(seen[1]).toEqual([first, records[1]!.hash, view])
    expect(new Map(view).get(records[1]!.hash)).toBe(first)
  })

  it('should not find other hashes', async () => {
    const view = await decodeRecordsView(await encodeRecords({ [records[0]!.hash]: records[0] }))
    expect(view.has('ffffffffffffffff')).toBe(false)
    expect(view.get('ffffffffffffffff')).toBeUndefined()
  })

  it('should reject other data up front', async () => {
    await expect(decodeRecordsView('{"version":1}')).rejects.toThrow('unsupported records pack')
    await expect(decodeRecordsView(`{"version":1,"strings":[],"columns":[${'[],'.repeat(13)}[]]}`)).rejects.toThrow('unsupported records pack')
    await expect(decodeRecordsView(`{"version":1,"strings":[],"columns":[[1]${',[]'.repeat(14)}]}`)).rejects.toThrow('malformed records pack')
    await expect(decodeRecordsView(`{"version":1,"strings":["${at}"],"columns":[["${records[0]!.hash}"],["Hello"],["Bonjour"],[0],[1],[0,0]${',[]'.repeat(9)}]}`)).rejects.toThrow('malformed records pack')
    await expect(decodeRecordsView(`{"version":1,"strings":[null],"columns":[[]${',[]'.repeat(14)}]}`)).rejects.toThrow('malformed records pack')
    const duplicate = `{"version":1,"strings":["${at}"],"columns":[["${records[0]!.hash}","${records[0]!.hash}"],["Hello","Hi"],["Bonjour","Salut"],[0,0],[1,1]${',[]'.repeat(10)}]}`
    await expect(decodeRecordsView(duplicate)).rejects.toThrow('malformed records pack')
    await expect(decodeRecords(duplicate)).rejects.toThrow('malformed records pack')
  })

  it('should throw when reading a malformed record', async () => {
    const rows = [['1d4e5186ed79d236', 0, 1], ['2a4e5186ed79d236', 99, 1], ['3a4e5186ed79d236', 0, 2], ['4a4e5186ed79d236', 0, 0]] as const
    const columns = [rows.map(row => row[0]), rows.map(() => 'Hello'), rows.map(() => 'Bonjour'), rows.map(row => row[1]), rows.map(row => row[2]), ...Array.from({ length: 10 }, () => [])]
    const data = JSON.stringify({ version: 1, strings: [at], columns })
    const view = await decodeRecordsView(data)
    expect(view.get(rows[0][0])).toEqual({ hash: rows[0][0], source: 'Hello', text: 'Bonjour', origin: 'mt', review: 'none', derived: 'fresh', updatedAt: at })
    for (const [i, [hash]] of rows.entries()) {
      if (i)
        expect(() => view.get(hash)).toThrow(`malformed records pack at row ${i}`)
    }
    await expect(decodeRecords(data)).rejects.toThrow('malformed records pack at row 1')
  })
})
