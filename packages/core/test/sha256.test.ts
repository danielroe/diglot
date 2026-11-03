import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256 } from '../src/sha256.ts'

describe('sha256', () => {
  it('should match node:crypto across block boundaries and multibyte input', () => {
    const inputs = ['', 'abc', 'plain\0salt\0Hello', '日本語のドキュメント 🚀', 'é'.repeat(200)]
    for (let length = 50; length <= 130; length++)
      inputs.push('x'.repeat(length))
    for (const input of inputs)
      expect(sha256(input), JSON.stringify(input)).toBe(createHash('sha256').update(input).digest('hex'))
  })
})
