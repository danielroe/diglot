import type { ApplySegmentEvent, Segment, TranslationRecord } from '@diglot/core'
import type { Annotation, MdNode } from '../src/index.ts'
import { readFileSync } from 'node:fs'
import { extract as extractComark, parse as parseComark } from '@diglot/comark'
import { createRecord, pseudoTranslate } from '@diglot/core'
import rehypeStringify from 'rehype-stringify'
import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdc from 'remark-mdc'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it, vi } from 'vitest'
import { annotate, apply, extract, parse } from '../src/index.ts'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/nuxt/${name}`, import.meta.url), 'utf8')
const pseudo = (segments: Segment[]) => new Map(segments.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)]))
const FIXTURES = ['edges.md', 'env.md', 'layers.md', 'client-only.md']
const PAGE = '---\ntitle: Data fetching\n---\n\n# Hello world\n\nSecond paragraph.\n\nRead [the docs](/d).\n\n![Logo](/l.png)\n\n:read-more{to="/x" title="Read more"}\n\n- item one\n- item two\n'
function pageTranslations(segments: Segment[]) {
  const [title, heading, , link, , , prop, item] = segments
  return new Map<string, string | TranslationRecord>([
    [title!.hash, createRecord({ segment: title!, text: 'Récupération', origin: 'mt' })],
    [heading!.hash, createRecord({ segment: heading!, text: 'Bonjour le monde', origin: 'mt', review: 'verified', verifiedBy: { by: 'danielroe', at: '2026-11-01T00:00:00.000Z' } })],
    [link!.hash, createRecord({ segment: link!, text: 'Lisez la doc.', origin: 'mt' })],
    [prop!.hash, 'Lire plus'],
    [item!.hash, createRecord({ segment: item!, text: 'premier', origin: 'mt', review: 'edited' })],
  ])
}
function mark(events: ApplySegmentEvent[]) {
  return (event: ApplySegmentEvent) => {
    events.push(event)
    if (event.outcome === 'skipped')
      return
    event.target?.setAttribute('data-status', event.status ?? 'unknown')
    if (event.outcome !== 'translated')
      event.target?.setAttribute('lang', 'en')
  }
}
const summary = (events: ApplySegmentEvent[]) => events.map(e => [e.segment.kind, e.outcome, e.status, e.target ? 'block' : null, e.errors.map(i => i.code)])
async function toHtml(markdown: string, annotations: Annotation[]) {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMdc).use(remarkFrontmatter).parse(markdown)
  annotate(tree, annotations)
  const html = unified().use(remarkRehype).use(rehypeStringify)
  return html.stringify(await html.run(tree))
}

describe('extract', () => {
  it('should slice protected spans and attributes from the source', async () => {
    const [segment] = await extract('See [the docs](/docs "Title"){target="_blank"}, `useFetch`{lang="ts"}, {{ value }} and <kbd>Ctrl</kbd>.')
    expect(segment!.skeleton).toBe('See {0}the docs{/0}, {1}, {2} and {3}.')
    expect(segment!.placeholders.map(p => p.source + (p.close ?? ''))).toEqual(['[](/docs "Title"){target="_blank"}', '`useFetch`{lang="ts"}', '{{ value }}', '<kbd>Ctrl</kbd>'])
  })

  it('should drop heading attributes from heading text', async () => {
    const [segment] = await extract('## Custom anchor {#custom}')
    expect(segment!.skeleton).toBe('Custom anchor')
  })

  it('should give node-precise positions', async () => {
    const segments = await extract('# Title\n\nFirst line\nsecond line.\n\n- item\n')
    expect(segments.map(s => [s.kind, s.position.startLine, s.position.endLine, s.position.precision])).toEqual([
      ['heading', 1, 1, 'node'],
      ['paragraph', 3, 4, 'node'],
      ['list-item', 6, 6, 'node'],
    ])
  })

  it('should produce the same hashes as the comark adapter outside known parser differences', async () => {
    for (const name of FIXTURES) {
      const source = fixture(name)
      const comark = (await extractComark(await parseComark(source))).segments
      const mdast = await extract(source)
      const only = (a: Segment[], b: Segment[]) => a.filter(s => !b.some(o => o.hash === s.hash)).map(s => s.skeleton)
      expect({ comark: only(comark, mdast), mdast: only(mdast, comark) }, name).toEqual(name === 'edges.md'
        ? {
            comark: ['You can also use a function to conditionally transpile. The function will receive an object ().', 'Do not import from {0} in server code. Use {1} or Ctrl{2} instead.', 'Nuxt latest version'],
            mdast: ['You can also use a function to conditionally transpile. The function will receive an object (\\{ isDev, isServer, isClient, isModern, isLegacy \\}).', 'Do not import from {0} in server code. Use {1} or {2} instead.'],
          }
        : { comark: [], mdast: [] })
    }
  })
})

describe('satteri parser', () => {
  const remark = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkFrontmatter)
  const keys = ['value', 'depth', 'lang', 'meta', 'alt', 'url', 'title', 'identifier', 'label', 'referenceType', 'ordered', 'checked', 'name', 'attributes']
  const shape = (n: MdNode): unknown => ({
    type: n.type,
    ...Object.fromEntries(keys.filter(k => k in n).map(k => [k, n[k as keyof MdNode]])),
    position: [n.position?.start, n.position?.end].map(p => [p?.offset, p?.line, p?.column]),
    ...(n.children ? { children: n.children.map(shape) } : {}),
  })
  const UNICODE = '---\ntitle: Héllo 😀\n---\n\n# Ünïcode 😀 title\n\nSee [the docs](/d "Docs"), [ref][r] and `code` 😀 é, Type:string at 10:30am.\n\n| a | b |\n|---|---|\n| 😀 | é |\n\n- [ ] task\n\n[r]: /r\n'
  const ASIDES = ':::note\nHello 😀 world.\n:::\n\n:::tip[Did you know?]\nAstro helps.\n\nPress :kbd[Ctrl] now.\n:::\n'

  it('should parse the same tree and offsets as remark-directive', async () => {
    for (const [name, source] of [...FIXTURES.map(name => [name, fixture(name)]), ['unicode', UNICODE], ['asides', ASIDES]] as const) {
      const expected = shape(await remark.run(remark.parse(source)) as MdNode)
      expect(shape(await parse(source, { parser: 'satteri' })), name).toEqual(expected)
    }
  })

  it('should extract the same segments as remark without MDC', async () => {
    expect(await extract(UNICODE, { parser: 'satteri' })).toEqual(await extract(UNICODE))
  })

  it('should extract and apply a pseudo-translated document', async () => {
    const segments = await extract(UNICODE, { parser: 'satteri' })
    expect(segments.map(s => s.skeleton)).toEqual(['Héllo 😀', 'Ünïcode 😀 title', 'See {0}the docs{/0}, {1} and {2} 😀 é, Type:string at 10:30am.', 'a', 'b', '😀', 'é', 'task'])
    const { markdown, report } = await apply(UNICODE, pseudo(segments), { parser: 'satteri' })
    expect(report.applied).toBe(segments.length)
    expect((await extract(markdown, { parser: 'satteri' })).map(s => s.skeleton)).toEqual(segments.map(s => pseudoTranslate(s.skeleton, s.format)))
  })

  it('should translate asides and their titles', async () => {
    const segments = await extract(ASIDES, { parser: 'satteri' })
    expect(segments.map(s => [s.kind, s.context.containers, s.skeleton])).toEqual([
      ['component-slot', ['note'], 'Hello 😀 world.'],
      ['component-slot', ['tip'], 'Did you know?'],
      ['component-slot', ['tip'], 'Astro helps.'],
      ['component-slot', ['tip'], 'Press {0} now.'],
    ])
    const { markdown, report } = await apply(ASIDES, pseudo(segments), { parser: 'satteri' })
    expect(report.applied).toBe(segments.length)
    expect(markdown).toBe(':::note\n⟦Hélló 😀 wórld.⟧\n:::\n\n:::tip[⟦Díd yóú knów?⟧]\n⟦Ástró hélps.⟧\n\n⟦Préss⟧ :kbd[Ctrl] ⟦nów.⟧\n:::\n')
  })

  it('should rethrow satteri load errors other than a missing package', async () => {
    vi.resetModules()
    vi.doMock('satteri', () => {
      throw new Error('Cannot find native binding.')
    })
    try {
      const { parse } = await import('../src/parse.ts')
      await expect(parse('# Title', { parser: 'satteri' })).rejects.toHaveProperty('cause.message', 'Cannot find native binding.')
    }
    finally {
      vi.doUnmock('satteri')
    }
  })
})

describe('onSegment', () => {
  it('should report each segment and annotate block nodes', async () => {
    const segments = await extract(PAGE)
    const events: ApplySegmentEvent[] = []
    const { markdown, report, annotations } = await apply(PAGE, pageTranslations(segments), { onSegment: mark(events) })
    expect(events.map(e => e.segment)).toEqual(segments)
    expect(summary(events)).toEqual([
      ['frontmatter', 'translated', 'machine', null, []],
      ['heading', 'translated', 'verified', 'block', []],
      ['paragraph', 'missing', 'untranslated', 'block', []],
      ['paragraph', 'rejected', 'rejected', 'block', ['missing-placeholder']],
      ['image-alt', 'missing', 'untranslated', null, []],
      ['paragraph', 'skipped', 'untranslated', 'block', []],
      ['prop', 'translated', undefined, null, []],
      ['list-item', 'translated', 'edited', 'block', []],
      ['list-item', 'missing', 'untranslated', 'block', []],
    ])
    expect(events[1]!.record?.text).toBe('Bonjour le monde')
    expect(report).toEqual({ applied: 4, missing: 4, rejected: [expect.objectContaining({ hash: segments[3]!.hash })] })
    expect(markdown).toBe(PAGE.replace('Data fetching', 'Récupération').replace('Hello world', 'Bonjour le monde').replace('Read more', 'Lire plus').replace('item one', 'premier'))
    expect(await toHtml(markdown, annotations!)).toBe([
      '<h1 data-status="verified">Bonjour le monde</h1>',
      '<p data-status="untranslated" lang="en">Second paragraph.</p>',
      '<p data-status="rejected" lang="en">Read <a href="/d">the docs</a>.</p>',
      '<p><img src="/l.png" alt="Logo"></p>',
      '<div></div>',
      '<ul>',
      '<li>',
      '<span data-status="edited">premier</span>',
      '</li>',
      '<li>',
      '<span data-status="untranslated" lang="en">item two</span>',
      '</li>',
      '</ul>',
    ].join('\n'))
  })

  it('should annotate table cells, component slots and loose list items', async () => {
    const { annotations, markdown } = await apply('| a |\n|---|\n| b |\n\n::tip\nBody text.\n::\n\n1. one\n\n2. two', new Map(), { onSegment: mark([]) })
    expect(await toHtml(markdown, annotations!)).toBe([
      '<table>',
      '<thead>',
      '<tr>',
      '<th data-status="untranslated" lang="en">a</th>',
      '</tr>',
      '</thead>',
      '<tbody>',
      '<tr>',
      '<td data-status="untranslated" lang="en">b</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '<div><p data-status="untranslated" lang="en">Body text.</p></div>',
      '<ol>',
      '<li>',
      '<p data-status="untranslated" lang="en">one</p>',
      '</li>',
      '<li>',
      '<p data-status="untranslated" lang="en">two</p>',
      '</li>',
      '</ol>',
    ].join('\n'))
  })

  it('should report code comments without a target', async () => {
    const events: ApplySegmentEvent[] = []
    const result = await apply('```ts\n// Fetch it here\n```', new Map(), { onSegment: mark(events) })
    expect(summary(events)).toEqual([['code-comment', 'missing', 'untranslated', null, []]])
    expect(result.annotations).toEqual([])
    expect(await apply('Hello.', new Map())).toEqual({ markdown: 'Hello.', report: { applied: 0, missing: 1, rejected: [] } })
  })
})

describe('apply', () => {
  it('should apply every segment of a pseudo-translated document', async () => {
    for (const name of FIXTURES) {
      const source = fixture(name)
      const segments = await extract(source)
      const { markdown, report } = await apply(source, pseudo(segments))
      expect(report, name).toEqual({ applied: segments.length, missing: 0, rejected: [] })
      const key = (s: Segment, skeleton: string) => `${s.kind}|${skeleton.replace(/\\/g, '')}`
      const again = (await extract(markdown)).filter(s => s.kind !== 'code-label').map(s => key(s, s.skeleton))
      expect(again, name).toEqual(segments.filter(s => s.kind !== 'code-label').map(s => key(s, pseudoTranslate(s.skeleton, s.format))))
    }
  })

  it('should leave everything outside translated units untouched', async () => {
    const source = '<!-- keep me -->\n\nHello   [world](/w)  \nagain.\n\n* list\n'
    const [first] = await extract(source)
    const { markdown } = await apply(source, new Map([[first!.hash, 'Bonjour {0}monde{/0}{1}encore.']]))
    expect(markdown).toBe('<!-- keep me -->\n\nBonjour [monde](/w)  \nencore.\n\n* list\n')
  })

  it('should translate image alts inside a translated paragraph', async () => {
    const source = 'See [![The logo](/l.png)](/home) here.'
    const segments = await extract(source)
    const translations = new Map([[segments[0]!.hash, 'Le logo'], [segments[1]!.hash, 'Voir {0} ici.']])
    expect((await apply(source, translations)).markdown).toBe('See [![Le logo](/l.png)](/home) here.'.replace('See', 'Voir').replace('here', 'ici'))
  })

  it('should extract and apply dotted frontmatter keys in literal and nested form', async () => {
    const literal = '---\nnavigation.title: MCP Server\n---\n\nBody.'
    const nested = '---\nnavigation:\n  title: MCP Server\n---\n\nBody.'
    const [a] = await extract(literal)
    const [b] = await extract(nested)
    expect([a!.kind, a!.skeleton, a!.context.detail]).toEqual(['frontmatter', 'MCP Server', 'navigation.title'])
    expect(b!.hash).toBe(a!.hash)
    const translations = new Map([[a!.hash, 'Serveur MCP']])
    expect((await apply(literal, translations)).markdown).toBe(literal.replace('MCP Server', 'Serveur MCP'))
    expect((await apply(nested, translations)).markdown).toBe(nested.replace('MCP Server', 'Serveur MCP'))
  })

  it('should apply props, frontmatter, labels and code comments', async () => {
    const source = [
      '---',
      'title: Data fetching',
      'links:',
      '  - label: Source',
      '---',
      '',
      ':read-more{to="/x" title="Read more"}',
      '',
      '- item',
      '  ::card',
      '  ---',
      '  title: Yaml title',
      '  ---',
      '  Body',
      '  ::',
      '',
      '  ```ts [Directory Structure]',
      '  // Fetch it here',
      '  ```',
    ].join('\n')
    const segments = await extract(source)
    expect(segments.map(s => s.kind)).toEqual(['frontmatter', 'frontmatter', 'prop', 'list-item', 'prop', 'component-slot', 'code-label', 'code-comment'])
    const { markdown, report } = await apply(source, new Map(segments.map(s => [s.hash, `FR: ${s.skeleton}`])))
    expect(report.applied).toBe(segments.length)
    expect(markdown).toBe([
      '---',
      'title: "FR: Data fetching"',
      'links:',
      '  - label: "FR: Source"',
      '---',
      '',
      ':read-more{to="/x" title="FR: Read more"}',
      '',
      '- FR: item',
      '  ::card',
      '  ---',
      '  title: "FR: Yaml title"',
      '  ---',
      '  FR: Body',
      '  ::',
      '',
      '  ```ts [FR: Directory Structure]',
      '  // FR: Fetch it here',
      '  ```',
    ].join('\n'))
  })

  it('should keep the line break after block scalar frontmatter', async () => {
    const source = '---\ndescription: >-\n  How to add\n  scripts.\nlang: en\n---\n\nBody.\n'
    const [description] = await extract(source)
    const { markdown } = await apply(source, new Map([[description!.hash, 'Comment ajouter des scripts.']]))
    expect(markdown).toBe('---\ndescription: Comment ajouter des scripts.\nlang: en\n---\n\nBody.\n')
  })

  it('should keep the comment on a block scalar frontmatter header', async () => {
    const source = '---\ndescription: >- # keep short\n  How to add\n  scripts.\nlang: en\n---\n\nBody.\n'
    const [description] = await extract(source)
    const { markdown } = await apply(source, new Map([[description!.hash, 'Comment ajouter des scripts.']]))
    expect(markdown).toBe('---\ndescription: Comment ajouter des scripts. # keep short\nlang: en\n---\n\nBody.\n')
  })

  it('should keep CRLF line breaks after block scalar frontmatter', async () => {
    const source = '---\r\ndescription: >-\r\n  How to add\r\n  scripts.\r\nlang: en\r\n---\r\n\r\nBody.\r\n'
    const [description] = await extract(source)
    const { markdown } = await apply(source, new Map([[description!.hash, 'Comment ajouter des scripts.']]))
    expect(markdown).toBe('---\r\ndescription: Comment ajouter des scripts.\r\nlang: en\r\n---\r\n\r\nBody.\r\n')
  })

  it('should reject translations it cannot address and keep the source', async () => {
    const source = ':read-more{to="/x" title="Read more"}'
    const [segment] = await extract(source)
    const { markdown, report } = await apply(source, new Map([[segment!.hash, 'Say "hi" and \'bye\'']]))
    expect(markdown).toBe(source)
    expect(report.rejected[0]!.errors[0]!.code).toBe('unaddressable')
  })

  it('should keep the source for invalid translations', async () => {
    const source = 'Hello [world](/w).'
    const [segment] = await extract(source)
    const { markdown, report } = await apply(source, new Map([[segment!.hash, 'Bonjour [monde](https://evil.example).']]))
    expect(markdown).toBe(source)
    expect(report.rejected).toHaveLength(1)
  })
})
