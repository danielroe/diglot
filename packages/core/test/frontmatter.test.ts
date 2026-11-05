import { describe, expect, it } from 'vitest'
import { setAtPath, stringsAtPaths, yamlScalarSpan } from '../src/index.ts'

const PATHS = ['title', 'navigation.title', 'links[].label']

describe('stringsAtPaths', () => {
  it('should read nested and literal dotted keys', () => {
    const nested = { title: 'MCP', navigation: { title: 'MCP Server' }, links: [{ label: 'Source' }] }
    const literal = { 'title': 'MCP', 'navigation.title': 'MCP Server', 'links': [{ label: 'Source' }] }
    expect([...stringsAtPaths(nested, PATHS)]).toEqual([[['title'], 'MCP'], [['navigation', 'title'], 'MCP Server'], [['links', 0, 'label'], 'Source']])
    expect([...stringsAtPaths(literal, PATHS)]).toEqual([[['title'], 'MCP'], [['navigation.title'], 'MCP Server'], [['links', 0, 'label'], 'Source']])
  })

  it('should prefer the literal key and fall back to the nested path', () => {
    expect([...stringsAtPaths({ 'navigation.title': 'Literal', 'navigation': { title: 'Nested' } }, PATHS)]).toEqual([[['navigation.title'], 'Literal']])
    expect([...stringsAtPaths({ 'navigation.title': '', 'navigation': { title: 'Nested' } }, PATHS)]).toEqual([[['navigation', 'title'], 'Nested']])
  })

  it('should write back to the key that was read', () => {
    const data = { 'navigation.title': 'MCP Server' }
    for (const [path] of stringsAtPaths(data, PATHS))
      setAtPath(data, path, 'Serveur MCP')
    expect(data).toEqual({ 'navigation.title': 'Serveur MCP' })
  })
})

describe('yamlScalarSpan', () => {
  it('should leave the trailing line break of a block scalar outside the span', () => {
    const source = 'a: >-\r\n  b\r\nc: d\r\n'
    expect(yamlScalarSpan(source, 3, source.indexOf('c:'))).toEqual({ start: 3, end: source.indexOf('\r\nc:'), suffix: '' })
  })

  it('should return the comment on a block scalar header as a suffix', () => {
    const source = 'a: |2- # note\n   b\nc: d\n'
    expect(yamlScalarSpan(source, 3, source.indexOf('c:'))).toEqual({ start: 3, end: source.indexOf('\nc:'), suffix: ' # note' })
  })

  it('should keep the span of a flow scalar', () => {
    const source = 'a: "b # c" # note\n'
    expect(yamlScalarSpan(source, 3, 10)).toEqual({ start: 3, end: 10, suffix: '' })
  })
})
