import { describe, expect, it } from 'vitest'
import { frontmatterValues, htmlInline, setAtPath, stringsAtPaths, yamlScalarSpan } from '../src/index.ts'

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

describe('htmlInline', () => {
  it('should keep the text of links translatable and protect other markup', () => {
    expect(htmlInline('New <a href="/release/">release</a> is <strong>out</strong><br>now')).toEqual([
      { type: 'text', value: 'New ' },
      { type: 'link', open: '<a href="/release/">', close: '</a>', children: [{ type: 'text', value: 'release' }] },
      { type: 'text', value: ' is ' },
      { type: 'atomic', kind: 'html', name: 'strong', source: '<strong>out</strong>', hidesText: true },
      { type: 'atomic', kind: 'html', name: 'br', source: '<br>' },
      { type: 'text', value: 'now' },
    ])
  })

  it('should read a `>` inside a quoted attribute as part of the tag', () => {
    expect(htmlInline('<a title="a > b" href="/x/">link</a>')).toEqual([
      { type: 'link', open: '<a title="a > b" href="/x/">', close: '</a>', children: [{ type: 'text', value: 'link' }] },
    ])
  })

  it('should match nested elements of the same name and keep unclosed tags apart', () => {
    expect(htmlInline('<span><span>a</span></span> <i>b')).toEqual([
      { type: 'atomic', kind: 'html', name: 'span', source: '<span><span>a</span></span>', hidesText: true },
      { type: 'text', value: ' ' },
      { type: 'atomic', kind: 'html', name: 'i', source: '<i>' },
      { type: 'text', value: 'b' },
    ])
  })
})

describe('frontmatterValues', () => {
  it('should split the values at htmlFrontmatter paths only', () => {
    const data = { title: 'A <b>bold</b> title', banner: { content: 'See <a href="/x/">this</a>' } }
    expect(frontmatterValues(data, { frontmatter: ['title', 'banner.content'], htmlFrontmatter: ['banner.content', 'hero.tagline'] })).toEqual([
      [['title'], 'A <b>bold</b> title'],
      [['banner', 'content'], [{ type: 'text', value: 'See ' }, { type: 'link', open: '<a href="/x/">', close: '</a>', children: [{ type: 'text', value: 'this' }] }]],
    ])
  })
})
