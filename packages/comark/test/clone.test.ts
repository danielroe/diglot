import { describe, expect, it } from 'vitest'
import { clone } from '../src/clone.ts'

describe('clone', () => {
  it('should copy like structuredClone', () => {
    const shared = { a: 1 }
    const value: Record<string, unknown> = { list: [shared, shared, 'x', null, [1, [2]]], date: new Date(0), map: new Map([['k', 1]]) }
    value.self = value
    const copy = clone(value)
    expect(copy).toEqual(structuredClone(value))
    expect(copy).not.toBe(value)
    expect((copy.list as unknown[])[0]).not.toBe(shared)
    expect((copy.list as unknown[])[0]).toBe((copy.list as unknown[])[1])
    expect(copy.self).toBe(copy)
    expect(copy.date).toBeInstanceOf(Date)
    expect(copy.date).not.toBe(value.date)
  })
})
