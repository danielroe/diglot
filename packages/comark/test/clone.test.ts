import { describe, expect, it } from 'vitest'
import { clone } from '../src/clone.ts'

describe('clone', () => {
  it('should copy like structuredClone', () => {
    const shared = { a: 1 }
    const value: Record<string, unknown> = { list: [shared, shared, 'x', null, [1, [2]]], date: new Date(0), map: new Map([['k', 1]]), parsed: JSON.parse('{"__proto__":{"x":1}}') }
    value.self = value
    value.again = value.date
    const copy = clone(value)
    expect(copy).toEqual(structuredClone(value))
    expect(copy).not.toBe(value)
    expect((copy.list as unknown[])[0]).not.toBe(shared)
    expect((copy.list as unknown[])[0]).toBe((copy.list as unknown[])[1])
    expect(copy.self).toBe(copy)
    expect(copy.date).toBeInstanceOf(Date)
    expect(copy.date).not.toBe(value.date)
    expect(copy.again).toBe(copy.date)
    expect(Object.keys(copy.parsed as object)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(copy.parsed)).toBe(Object.prototype)
  })
})
