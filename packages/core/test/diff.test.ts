import type { DiffableSegment } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { diffSegments, hashSkeleton, sentenceDiff, similarity } from '../src/index.ts'

const seg = (skeleton: string, kind: DiffableSegment['kind'] = 'paragraph'): DiffableSegment => ({ hash: hashSkeleton(skeleton), kind, format: 'markdown', skeleton })

describe('diffSegments', () => {
  it('should classify unchanged, added, removed and modified segments', () => {
    const before = [seg('Introduction'), seg('Nuxt fetches data with {0}.'), seg('This section is going away entirely.')]
    const after = [seg('Introduction'), seg('Nuxt fetches data with {0} and {1}.'), seg('Completely unrelated new prose here.')]
    const diff = diffSegments(before, after)
    expect(diff.unchanged.map(s => s.skeleton)).toEqual(['Introduction'])
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0]!.before.skeleton).toBe('Nuxt fetches data with {0}.')
    expect(diff.modified[0]!.ambiguous).toBe(false)
    expect(diff.added.map(s => s.skeleton)).toEqual(['Completely unrelated new prose here.'])
    expect(diff.removed.map(s => s.skeleton)).toEqual(['This section is going away entirely.'])
  })

  it('should treat duplicate hashes as a multiset', () => {
    const diff = diffSegments([seg('Type'), seg('Type')], [seg('Type')])
    expect(diff.unchanged).toHaveLength(1)
    expect(diff.removed).toHaveLength(1)
  })

  it('should flag a match as ambiguous when a rival scores close', () => {
    const filler = ['One', 'Two', 'Three'].map(s => seg(s))
    const diff = diffSegments([...filler, seg('Testing Nuxt 4')], [...filler, seg('Testing Nuxt 5'), seg('Testing Nuxt 6')])
    expect(diff.modified[0]!.ambiguous).toBe(true)
  })

  it('should respect the threshold and never pair plain with markdown', () => {
    expect(diffSegments([seg('abc def')], [seg('xyz uvw')]).modified).toHaveLength(0)
    const plain = { ...seg('Same text here'), format: 'plain' as const, hash: 'x' }
    expect(diffSegments([seg('Same text here!')], [plain]).modified).toHaveLength(0)
  })

  it('should compute normalised similarity', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('', '')).toBe(1)
    expect(similarity('abcd', 'abcx')).toBe(0.75)
  })
})

describe('sentenceDiff', () => {
  it('should report the one changed sentence', () => {
    const diff = sentenceDiff('A object is returned. It is cached. Use {0}.', 'An object is returned. It is cached. Use {0}.')
    expect(diff.changed).toEqual([0])
    expect(diff.dropped).toEqual([0])
    expect(diff.after).toHaveLength(3)
  })

  it('should report added sentences only as changed', () => {
    const diff = sentenceDiff('One. Two.', 'One. New. Two.')
    expect(diff.changed).toEqual([1])
    expect(diff.dropped).toEqual([])
  })
})
