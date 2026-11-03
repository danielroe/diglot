import { describe, expect, it } from 'vitest'
import { decodeRecords, decodeRecordsView, encodeRecords } from '../src/runtime.ts'
import { withoutBuiltins } from './no-builtins.ts'

describe('encodeRecords without Node built-ins', () => {
  withoutBuiltins()

  it('should round-trip through CompressionStream', async () => {
    const record = { hash: '1d4e5186ed79d236', source: 'Hello', text: 'Bonjour', origin: 'mt', review: 'none', derived: 'fresh', mt: { model: 'm', candidate: 'Bonjour' }, updatedAt: '2026-11-01T00:00:00.000Z' }
    const data = await encodeRecords({ [record.hash]: record })
    expect(data.startsWith('H4sI')).toBe(true)
    expect((await decodeRecords(data)).get(record.hash)).toEqual(record)
    expect((await decodeRecordsView(data)).get(record.hash)).toEqual(record)
  })

  it('should refuse zstd', async () => {
    await expect(encodeRecords({}, { compression: 'zstd' })).rejects.toThrow('zstd compression needs node:zlib')
    await expect(decodeRecords('KLUv/QBYAAA=')).rejects.toThrow('zstd decompression needs node:zlib')
  })
})
