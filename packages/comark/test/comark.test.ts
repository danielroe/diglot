import type { ApplySegmentEvent, Segment, TranslationRecord } from '@diglot/core'
import type { Node } from 'comark'
import type { ComarkDocument } from '../src/index.ts'
import { readFileSync } from 'node:fs'
import { createRecord, pseudoTranslate } from '@diglot/core'
import { createMarkdownParser } from 'comark'
import { describe, expect, it } from 'vitest'
import { apply, applyNavigation, extract, extractNavigation, parse, render } from '../src/index.ts'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/nuxt/${name}`, import.meta.url), 'utf8')
const pseudo = (segments: Segment[]) => new Map(segments.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)]))
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
const skeletons = async (doc: ComarkDocument) => (await extract(doc)).segments.map(s => s.skeleton)
const headingIds = (nodes: Node[]): string[] => nodes.flatMap(n => Array.isArray(n) && typeof n[0] === 'string' ? [...(/^h[1-6]$/.test(n[0]) && n[1].id ? [String(n[1].id)] : []), ...headingIds(n.slice(2) as Node[])] : [])

describe('extract', () => {
  it('should extract every kind of unit from a document', async () => {
    const { segments } = await extract(await parse(fixture('edges.md')), { file: 'edges.md' })
    expect(segments.map(s => `${s.kind}: ${s.skeleton}`)).toMatchSnapshot()
    expect(segments.every(s => s.context.file === 'edges.md')).toBe(true)
    expect(segments.map(s => s.context.index)).toEqual(segments.map((_, i) => i))
  })

  it('should slice protected spans from the source', async () => {
    const source = 'See [the docs](/docs "Title"){target="_blank"}, `useFetch`{lang="ts"} and <img :zoom="false" src="/a.png">.'
    const { segments, spans } = await extract(await parse(source))
    expect(segments[0]!.placeholders.map(p => p.source + (p.close ?? ''))).toEqual(['[](/docs "Title"){target="_blank"}', '`useFetch`{lang="ts"}', '<img :zoom="false" src="/a.png">'])
    expect(spans).toEqual({ sliced: 3, rendered: 0 })
  })

  it('should re-render protected spans when there is no source', async () => {
    const { nodes, frontmatter } = await parse('Use `useFetch` and [docs](/docs).')
    const { segments, spans } = await extract({ nodes, frontmatter })
    expect(segments[0]!.skeleton).toBe('Use {0} and {1}docs{/1}.')
    expect(spans).toEqual({ sliced: 0, rendered: 2 })
  })

  it('should leave span sources empty without changing identity when they are not needed', async () => {
    const identity = (s: Segment) => ({ hash: s.hash, kind: s.kind, skeleton: s.skeleton, words: s.words, placeholders: s.placeholders.map(p => [p.type, p.name, p.hidesText, p.close === undefined]) })
    for (const name of ['edges.md', 'env.md', 'layers.md', 'client-only.md']) {
      const parsed = await parse(fixture(name))
      const full = await extract({ nodes: parsed.nodes, frontmatter: parsed.frontmatter })
      for (const doc of [parsed, { nodes: parsed.nodes, frontmatter: parsed.frontmatter }]) {
        const bare = await extract(doc, { spanSources: false })
        expect(bare.segments.map(identity)).toEqual(full.segments.map(identity))
        expect(bare.spans).toEqual({ sliced: 0, rendered: 0 })
      }
    }
    const { segments } = await extract(await parse('Use `useFetch` and [docs](/docs) with :badge[x].'), { spanSources: false })
    expect(segments[0]!.placeholders.map(p => [p.source, p.close])).toEqual([['', undefined], ['', ''], ['', undefined]])
  })

  it('should keep the hash when only protected spans change', async () => {
    const [a] = (await extract(await parse('Read [the guide](/docs/3.x/guide) about `useFetch`.'))).segments
    const [b] = (await extract(await parse('Read [the guide](/docs/guide) about `useAsyncData`.'))).segments
    expect(a!.hash).toBe(b!.hash)
    expect(a!.sourceHash).not.toBe(b!.sourceHash)
  })

  it('should segment single-paragraph components like a default comark parse', async () => {
    const source = '::note\nSome text that ends here.\n:read-more{title="SPA Loading Template" to="/docs"}\n::\n'
    const { segments } = await extract(await parse(source))
    expect(segments.map(s => `${s.kind}: ${s.skeleton}`)).toEqual(['component-slot: Some text that ends here.', 'prop: SPA Loading Template'])
    const { nodes, frontmatter } = await createMarkdownParser({ autoClose: false })(source)
    expect((await extract({ nodes, frontmatter })).segments.map(s => s.hash)).toEqual(segments.map(s => s.hash))
  })

  it('should keep inline components inside their sentence', async () => {
    for (const source of ['::tip\nPress :icon{name="x"} to continue.\n::\n', '> Press :icon{name="x"} to continue.\n', '- Press :icon{name="x"} to continue.\n\n- Two\n']) {
      const [segment] = (await extract(await parse(source))).segments
      expect(segment!.skeleton, source).toBe('Press {0} to continue.')
    }
    const [run] = (await extract(await parse('::tip\n:icon{name="a"}:icon{name="b"} to continue.\n::\n'))).segments
    expect(run!.skeleton).toBe('{0}{1} to continue.')
  })

  it('should split sentences around components on their own line', async () => {
    const { segments } = await extract(await parse('::note\nSome text.\n:read-more{title="Guide" to="/x"}\nMore text.\n::\n'))
    expect(segments.map(s => `${s.kind}: ${s.skeleton}`)).toEqual(['component-slot: Some text.', 'prop: Guide', 'component-slot: More text.'])
    const paragraph = await extract(await parse('Some text.\n:read-more{title="Guide" to="/x"}\n'))
    expect(paragraph.segments.map(s => `${s.kind}: ${s.skeleton}`)).toEqual(['paragraph: Some text.', 'prop: Guide'])
  })

  it('should record line positions of top-level blocks and code comments', async () => {
    const { segments } = await extract(await parse('# Title\n\nFirst paragraph.\n\n```ts\nconst a = 1\n// Explain the next line\n```\n'))
    expect(segments.map(s => [s.kind, s.position.startLine, s.position.endLine, s.position.precision])).toEqual([
      ['heading', 1, 1, 'block'],
      ['paragraph', 2, 3, 'block'],
      ['code-comment', 7, 7, 'node'],
    ])
  })

  it('should not extract code labels from synced code groups', async () => {
    const source = '::code-group{sync="pm"}\n```bash [Using npm]\nnpm i\n```\n::\n\n::code-group\n```bash [Using npm]\nnpm i\n```\n::'
    const { segments } = await extract(await parse(source))
    expect(segments.filter(s => s.kind === 'code-label')).toHaveLength(1)
  })

  it('should follow the policy for props and comments', async () => {
    const source = ':read-more{to="/x" title="Read more about it"}\n\n::tip{label="Custom label"}\nBody.\n::\n\n```ts\n// Explain the code here\n```'
    const defaults = (await extract(await parse(source))).segments.map(s => s.kind)
    expect(defaults).toEqual(['prop', 'component-slot', 'code-comment'])
    const custom = (await extract(await parse(source), { policy: { props: { tip: ['label'] }, codeComments: false } })).segments.map(s => s.skeleton)
    expect(custom).toEqual(['Custom label', 'Body.'])
  })
})

describe('apply', () => {
  it('should apply every segment of a pseudo-translated document and keep heading ids', async () => {
    for (const name of ['edges.md', 'env.md', 'layers.md', 'client-only.md']) {
      const doc = await parse(fixture(name))
      const { segments } = await extract(doc)
      const { doc: out, report } = await apply(doc, pseudo(segments))
      expect(report).toEqual({ applied: segments.length, missing: 0, rejected: [] })
      const unescaped = (list: Segment[], text: (s: Segment) => string) => list.filter(s => s.kind !== 'code-label').map(s => text(s).replace(/\\/g, ''))
      const again = unescaped((await extract(out)).segments, s => s.skeleton)
      expect(again).toEqual(unescaped(segments, s => pseudoTranslate(s.skeleton, s.format)))
      expect(headingIds(out.nodes)).toEqual(headingIds(doc.nodes))
      expect(headingIds((await parse(await render(out))).nodes)).toEqual(headingIds(doc.nodes))
    }
  })

  it('should produce the same document whether or not span sources are resolved', async () => {
    for (const name of ['edges.md', 'env.md', 'layers.md', 'client-only.md']) {
      const parsed = await parse(fixture(name))
      const doc = { nodes: parsed.nodes, frontmatter: parsed.frontmatter }
      const translations = pseudo((await extract(doc)).segments)
      const events: ApplySegmentEvent[] = []
      const resolved = await apply(doc, translations, { onSegment: e => events.push(e) })
      expect(await apply(doc, translations)).toEqual(resolved)
      expect(await apply(doc, translations, { onSegment: () => {}, spanSources: false })).toEqual(resolved)
      expect(events.map(e => e.segment.hash)).toEqual((await extract(doc)).segments.map(s => s.hash))
    }
    const events: ApplySegmentEvent[] = []
    await apply({ nodes: (await parse('Read [the docs](/d).')).nodes, frontmatter: {} }, new Map(), { onSegment: e => events.push(e) })
    expect(events[0]!.segment.text).toBe('Read [the docs](/d).')
  })

  it('should inject placeholders from the current source', async () => {
    const before = await parse('Read [the guide](/docs/3.x/guide) about `useFetch`.')
    const [segment] = (await extract(before)).segments
    const after = await parse('Read [the guide](/docs/guide) about `useAsyncData`.')
    const { doc } = await apply(after, new Map([[segment!.hash, 'Lisez {0}le guide{/0} sur **{1}**.']]))
    expect(doc.nodes).toEqual([['p', {}, 'Lisez ', ['a', { href: '/docs/guide' }, 'le guide'], ' sur ', ['strong', {}, ['code', {}, 'useAsyncData']], '.']])
  })

  it('should keep the line breaks around block components', async () => {
    const doc = await parse('::note\nSome text.\n:read-more{to="/x"}\nMore text.\n::\n')
    const { segments } = await extract(doc)
    const { doc: out } = await apply(doc, new Map(segments.map(s => [s.hash, s.skeleton.toUpperCase()])))
    expect(await render(out)).toBe('::note\nSOME TEXT.\n:read-more{to="/x"}\nMORE TEXT.\n::')
  })

  it('should keep the source for missing and invalid translations', async () => {
    const doc = await parse('Hello [world](/w).\n\nSecond paragraph.')
    const [first] = (await extract(doc)).segments
    const { doc: out, report } = await apply(doc, new Map([[first!.hash, 'Bonjour [monde](https://evil.example).']]))
    expect(out.nodes).toEqual(doc.nodes)
    expect(report.missing).toBe(1)
    expect(report.rejected[0]!.errors.map(e => e.code)).toEqual(expect.arrayContaining(['missing-placeholder', 'link-syntax']))
  })

  it('should extract and apply dotted frontmatter keys in literal and nested form', async () => {
    const literal = await parse('---\nnavigation.title: MCP Server\n---\n\nBody.')
    const nested = { ...literal, frontmatter: { navigation: { title: 'MCP Server' } } }
    const [a] = (await extract(literal)).segments
    const [b] = (await extract(nested)).segments
    expect([a!.kind, a!.skeleton, a!.context.detail]).toEqual(['frontmatter', 'MCP Server', 'navigation.title'])
    expect(b!.hash).toBe(a!.hash)
    const translations = new Map([[a!.hash, 'Serveur MCP']])
    expect((await apply(literal, translations)).doc.frontmatter).toEqual({ 'navigation.title': 'Serveur MCP' })
    expect((await apply(nested, translations)).doc.frontmatter).toEqual({ navigation: { title: 'Serveur MCP' } })
  })

  it('should apply props, alts, frontmatter and code comments', async () => {
    const source = '---\ntitle: Data fetching\n---\n\n![The logo](/l.png)\n\n:read-more{to="/x" title="Read more"}\n\n```ts\n// Fetch it here\n```'
    const doc = await parse(source)
    const { segments } = await extract(doc)
    const translations = new Map(segments.map(s => [s.hash, `FR ${s.skeleton}`]))
    const { doc: out } = await apply(doc, translations)
    expect(out.frontmatter.title).toBe('FR Data fetching')
    expect(await render(out)).toContain('![FR The logo](/l.png)')
    expect(await render(out)).toContain('title="FR Read more"')
    expect(await render(out)).toContain('// FR Fetch it here')
    expect(doc.frontmatter.title).toBe('Data fetching')
  })

  it('should substitute comments inside highlighted code', async () => {
    const doc = await parse('```ts\nconst a = 1 // the answer here\n```')
    const { segments } = await extract(doc)
    const pre = doc.nodes[0] as any
    pre[2] = ['code', {}, ['span', { class: 'line' }, ['span', {}, 'const a = 1 '], ['span', { class: 'comment' }, '// the answer'], ['span', { class: 'comment' }, ' here']]]
    const { doc: out } = await apply(doc, new Map([[segments[0]!.hash, 'la réponse']]))
    expect((out.nodes[0] as any)[2]).toEqual(['code', {}, ['span', { class: 'line' }, ['span', {}, 'const a = 1 '], ['span', { class: 'comment' }, '// la réponse'], ['span', { class: 'comment' }, '']]])
  })
})

describe('onSegment', () => {
  it('should report each segment and annotate block elements', async () => {
    const doc = await parse(PAGE)
    const { segments } = await extract(doc)
    const events: ApplySegmentEvent[] = []
    const { doc: out, report } = await apply(doc, pageTranslations(segments), { onSegment: mark(events) })
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
    expect(out.frontmatter.title).toBe('Récupération')
    expect(out.nodes).toEqual([
      ['h1', { 'id': 'hello-world', 'data-status': 'verified' }, 'Bonjour le monde'],
      ['p', { 'data-status': 'untranslated', 'lang': 'en' }, 'Second paragraph.'],
      ['p', { 'data-status': 'rejected', 'lang': 'en' }, 'Read ', ['a', { href: '/d' }, 'the docs'], '.'],
      ['p', {}, ['img', { src: '/l.png', alt: 'Logo' }]],
      ['read-more', { to: '/x', title: 'Lire plus' }],
      ['ul', {}, ['li', { 'data-status': 'edited' }, 'premier'], ['li', { 'data-status': 'untranslated', 'lang': 'en' }, 'item two']],
    ])
  })

  it('should annotate table cells and wrap component text in a span', async () => {
    const source = '| a |\n|---|\n| b |\n\n::tip\nBody text.\n::\n\n::note\nSome text that ends here.\n:read-more{title="SPA Loading Template" to="/docs"}\n::\n'
    const doc = await parse(source)
    const { doc: out } = await apply(doc, new Map(), { onSegment: mark([]) })
    const attrs = { 'data-status': 'untranslated', 'lang': 'en' }
    expect(out.nodes).toEqual([
      ['table', {}, ['thead', {}, ['tr', {}, ['th', attrs, 'a']]], ['tbody', {}, ['tr', {}, ['td', attrs, 'b']]]],
      ['tip', {}, ['span', attrs, 'Body text.']],
      ['note', {}, ['span', attrs, 'Some text that ends here.'], '\n', ['read-more', { title: 'SPA Loading Template', to: '/docs' }]],
    ])
    expect(await skeletons(await parse(await render(out)))).toEqual(await skeletons(out))
    expect(doc.nodes).toEqual((await parse(source)).nodes)
  })

  it('should wrap translated text and leave runs without attributes unwrapped', async () => {
    const doc = await parse('::note\nSome text that ends here.\n:read-more{title="SPA Loading Template" to="/docs"}\n::\n')
    const { segments } = await extract(doc)
    const translations = new Map([[segments[0]!.hash, 'Du texte qui finit ici.']])
    const { doc: plain } = await apply(doc, translations, { onSegment: () => {} })
    expect(plain.nodes).toEqual([['note', {}, 'Du texte qui finit ici.\n', ['read-more', { title: 'SPA Loading Template', to: '/docs' }]]])
    const { doc: out } = await apply(doc, translations, { onSegment: e => e.target?.setAttribute('data-status', 'machine') })
    expect(out.nodes).toEqual([['note', {}, ['span', { 'data-status': 'machine' }, 'Du texte qui finit ici.'], '\n', ['read-more', { title: 'SPA Loading Template', to: '/docs' }]]])
    expect(await skeletons(await parse(await render(out)))).toEqual(await skeletons(out))
    const root = await apply({ nodes: ['Loose text.'], frontmatter: {} }, new Map(), { onSegment: e => e.target?.setAttribute('lang', 'en') })
    expect(root.doc.nodes).toEqual([['span', { lang: 'en' }, 'Loose text.']])
  })

  it('should annotate the paragraph around an inline component', async () => {
    const doc = await parse('A sentence with :read-more{to="/x"} in the middle.')
    const { doc: out } = await apply(doc, new Map(), { onSegment: e => e.target?.setAttribute('lang', 'en') })
    expect(out.nodes).toEqual([['p', { lang: 'en' }, 'A sentence with ', ['read-more', { to: '/x' }], ' in the middle.']])
  })

  it('should report code comments without a target', async () => {
    const doc = await parse('```ts\n// Fetch it here\n```')
    const events: ApplySegmentEvent[] = []
    await apply(doc, new Map(), { onSegment: mark(events) })
    expect(summary(events)).toEqual([['code-comment', 'missing', 'untranslated', null, []]])
  })
})

describe('render', () => {
  it('should write hard breaks and bound attributes so they parse back', async () => {
    const doc = await parse('one :br :br two\n\n<img :zoom="false" src="/a.png">')
    const markdown = await render(doc)
    expect(markdown).toContain(':zoom="false"')
    const skeletons = async (d: typeof doc) => (await extract(d)).segments.map(s => s.skeleton)
    expect(await skeletons(await parse(markdown))).toEqual(await skeletons(doc))
    expect(await skeletons(doc)).toEqual(['one{0}{1}two', '{0}'])
  })
})

describe('navigation', () => {
  it('should extract and apply navigation titles', () => {
    const source = fixture('navigation.yml')
    const segments = extractNavigation(source)
    expect(segments.map(s => [s.context.detail, s.skeleton])).toEqual([['title', 'Get Started'], ['titleTemplate', '{0} · Get Started with Nuxt']])
    const { source: out, report } = applyNavigation(source, new Map([[segments[0]!.hash, 'Démarrer'], [segments[1]!.hash, '{0} · Démarrer avec Nuxt']]))
    expect(report.applied).toBe(2)
    expect(out).toBe(source.replace(/title: .*/, 'title: "Démarrer"').replace(/titleTemplate: .*/, 'titleTemplate: "%s · Démarrer avec Nuxt"'))
  })
})
