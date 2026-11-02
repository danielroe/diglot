import { describe, expect, it } from 'vitest'
import { setAtPath, stringsAtPaths } from '../src/index.ts'

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
