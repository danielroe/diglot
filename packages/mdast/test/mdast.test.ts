import type { Segment } from '@diglot/core'
import { readFileSync } from 'node:fs'
import { extract as extractComark, parse as parseComark } from '@diglot/comark'
import { pseudoTranslate } from '@diglot/core'
import { describe, expect, it } from 'vitest'
import { apply, extract } from '../src/index.ts'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/nuxt/${name}`, import.meta.url), 'utf8')
const pseudo = (segments: Segment[]) => new Map(segments.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)]))
const FIXTURES = ['edges.md', 'env.md', 'layers.md', 'client-only.md']

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
