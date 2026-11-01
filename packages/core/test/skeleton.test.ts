import type { InlineNode } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { buildSegment, countWords, escapeText, fromSkeleton, hashSkeleton, isPlaceholderOnly, normalise, parseSkeleton, toSkeleton } from '../src/index.ts'

const text = (value: string): InlineNode => ({ type: 'text', value })
const code = (source: string): InlineNode => ({ type: 'atomic', kind: 'code', source })
const brk: InlineNode = { type: 'atomic', kind: 'break', source: ' :br ' }
const link = (children: InlineNode[], close = '](https://nitro.build/)'): InlineNode => ({ type: 'link', children, open: '[', close })

const position = { startLine: 1, endLine: 1, precision: 'block' as const }
const context = { headingTrail: [], containers: [] }

describe('skeleton', () => {
  it('should number atomic spans and wrap links with translatable text', () => {
    const result = toSkeleton(normalise([text('Nuxt is powered by '), link([text('Nitro')]), text(', see '), code('`useFetch`'), text('.')]))
    expect(result.skeleton).toBe('Nuxt is powered by {0}Nitro{/0}, see {1}.')
    expect(result.placeholders).toEqual([
      { id: 0, type: 'link', source: '[', close: '](https://nitro.build/)' },
      { id: 1, type: 'code', source: '`useFetch`' },
    ])
  })

  it('should make links atomic when their text is code or a URL', () => {
    expect(toSkeleton([link([code('`x`')])]).placeholders[0]).toEqual({ id: 0, type: 'link', source: '[`x`](https://nitro.build/)' })
    expect(toSkeleton([link([text('https://nuxt.com')], ']')]).skeleton).toBe('{0}')
  })

  it('should collapse whitespace and drop it next to hard breaks', () => {
    const a = toSkeleton(normalise([text('  one\n  two '), brk, text('  three ')])).skeleton
    const b = toSkeleton(normalise([text('one two'), brk, text('three')])).skeleton
    expect(a).toBe('one two{0}three')
    expect(a).toBe(b)
  })

  it('should keep emphasis markers and escape markdown punctuation', () => {
    const nodes: InlineNode[] = [{ type: 'strong', children: [text('NUXT_TEST')] }, text(' costs ~59% <of> {x}')]
    expect(toSkeleton(nodes).skeleton).toBe('**NUXT\\_TEST** costs \\~59% \\<of> \\{x\\}')
    expect(toSkeleton([text('1. Migrate')]).skeleton).toBe('1\\. Migrate')
    expect(escapeText('a :badge &amp;')).toBe('a \\:badge \\&amp;')
  })

  it('should not escape plain content', () => {
    expect(toSkeleton([text('a_b * c'), code('`x`')], 'plain').skeleton).toBe('a_b * c{0}')
  })

  it('should re-inject placeholders', () => {
    const { skeleton, placeholders } = toSkeleton([text('see '), link([text('Nitro')])])
    expect(fromSkeleton(skeleton, placeholders)).toBe('see [Nitro](https://nitro.build/)')
    expect(fromSkeleton('voir {0}Nitro{/0} \\{0}', placeholders)).toBe('voir [Nitro](https://nitro.build/) \\{0}')
  })

  it('should parse a translated skeleton into a tree', () => {
    const { placeholders } = toSkeleton([text('a '), link([text('b')]), text(' '), code('`c`')])
    expect(parseSkeleton('**x {0}y *z*{/0}** {1} \\*', placeholders)).toEqual([
      { type: 'strong', children: [
        { type: 'text', value: 'x ' },
        { type: 'placeholder', id: 0, children: [{ type: 'text', value: 'y ' }, { type: 'emphasis', children: [{ type: 'text', value: 'z' }] }] },
      ] },
      { type: 'text', value: ' ' },
      { type: 'placeholder', id: 1 },
      { type: 'text', value: ' *' },
    ])
  })

  it('should count words outside placeholders', () => {
    expect(countWords('{0} returns {1}Nuxt’s data{/1}.')).toBe(3)
    expect(isPlaceholderOnly('{0} {1}')).toBe(true)
    expect(isPlaceholderOnly('{0}s')).toBe(false)
  })
})

describe('buildSegment', () => {
  it('should hash the skeleton so protected span changes keep the identity', () => {
    const a = buildSegment({ kind: 'paragraph', content: [text('Use '), code('`a`')], context, position }, { file: 'a.md', index: 0 })!
    const b = buildSegment({ kind: 'paragraph', content: [text('Use '), code('`b`')], context, position }, { file: 'a.md', index: 0 })!
    expect(a.hash).toBe(b.hash)
    expect(a.sourceHash).not.toBe(b.sourceHash)
    expect(a.hash).toBe(hashSkeleton('Use {0}'))
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('should salt the hash when the policy asks for it', () => {
    const draft = { kind: 'table-cell' as const, content: [text('Type')], context, position }
    const plain = buildSegment(draft, { file: 'a.md', index: 0 })!
    const salted = buildSegment(draft, { file: 'a.md', index: 0, policy: { salt: ({ skeleton }) => skeleton === 'Type' ? 'table' : undefined } })!
    expect(salted.hash).not.toBe(plain.hash)
    expect(salted.salt).toBe('table')
    expect(salted.hash).toBe(hashSkeleton('Type', 'table'))
  })

  it('should treat string content as plain and skip empty units', () => {
    const segment = buildSegment({ kind: 'prop', content: '  Read   more ', context, position }, { file: 'a.md', index: 0 })!
    expect(segment.format).toBe('plain')
    expect(segment.skeleton).toBe('Read more')
    expect(buildSegment({ kind: 'prop', content: '   ', context, position }, { file: 'a.md', index: 0 })).toBeUndefined()
  })
})
