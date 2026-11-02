import type { Segment } from '@diglot/core'
import type { Node } from 'comark'
import { readFileSync } from 'node:fs'
import { pseudoTranslate } from '@diglot/core'
import { createMarkdownParser } from 'comark'
import { describe, expect, it } from 'vitest'
import { apply, applyNavigation, extract, extractNavigation, parse, render } from '../src/index.ts'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/nuxt/${name}`, import.meta.url), 'utf8')
const pseudo = (segments: Segment[]) => new Map(segments.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)]))
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
