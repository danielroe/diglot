import type { Segment } from '@diglot/core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { extract, transform } from '../src/index.ts'
import { components, fixtures } from './utils.ts'

const expected: Record<string, string[]> = JSON.parse(readFileSync(join(fixtures, 'segments.json'), 'utf8'))

function describeSegment(segment: Segment): string {
  const line = segment.position.startLine
  return segment.kind === 'prop' ? `${line} ${segment.context.detail}: ${segment.skeleton}` : `${line}: ${segment.skeleton}`
}

async function rewrite(code: string, file: string) {
  return (await transform(code, { file }))!
}

const skeletons = async (code: string, file: string) => (await extract(code, { file })).map(s => s.skeleton)

describe('fixtures', () => {
  const files = ['vue', 'react', 'svelte'].flatMap(framework => components(join(fixtures, framework)).map(file => `${framework}/${file}`))

  it.each(files)('should extract the segments of %s', async (file) => {
    const segments = await extract(readFileSync(join(fixtures, file), 'utf8'), { file })
    expect(segments.map(describeSegment)).toEqual(expected[file] ?? [])
  })
})

describe('vue', () => {
  const template = (markup: string) => `<template>${markup}</template>`

  it('should make one segment per run of text, with interpolations and inline elements as placeholders', async () => {
    expect(await skeletons(template('<p>Hi <b>{{ user.name }}</b>, read <a :href="u">the docs</a>.</p><h1>Title</h1>'), 'x.vue')).toEqual([
      'Hi {0}, read {1}the docs{/1}.',
      'Title',
    ])
  })

  it('should keep opted-out elements and code whole', async () => {
    const result = await rewrite(template('<div><p translate="no">Nimiq</p><p>Send <span translate="no">NIM</span> now, run <code>x</code></p><pre>a b</pre></div>'), 'x.vue')
    expect(result.segments.map(s => s.skeleton)).toEqual(['Send {0} now, run {1}'])
    expect(result.segments[0]!.placeholders.map(p => p.type)).toEqual(['html', 'code'])
    expect(result.code).toContain('<p translate="no">Nimiq</p>')
  })

  it('should translate readable attributes', async () => {
    const result = await rewrite(template('<img alt="Logo" src="/a.png"><input placeholder="Search" name="q">'), 'x.vue')
    expect(result.segments.map(s => [s.kind, s.context.detail, s.skeleton])).toEqual([
      ['prop', 'alt', 'Logo'],
      ['prop', 'placeholder', 'Search'],
    ])
    expect(result.code).toContain(`:alt="$diglot('${result.segments[0]!.hash}', 'Logo')"`)
  })

  it('should split runs at conditional and repeated elements', async () => {
    expect(await skeletons(template('<p>Status: <span v-if="ok">good</span><span v-else>bad</span></p>'), 'x.vue')).toEqual(['Status:', 'good', 'bad'])
  })

  it('should translate the attributes of elements whose content it leaves alone', async () => {
    const result = await rewrite(template('<textarea placeholder="Write a comment">draft</textarea><pre title="Output">a b</pre><code translate="no" title="Kept">x</code>'), 'x.vue')
    expect(result.segments.map(s => [s.context.detail, s.skeleton])).toEqual([['placeholder', 'Write a comment'], ['title', 'Output']])
  })

  it('should translate the attributes of elements inside a sentence', async () => {
    const result = await rewrite(template('<p>Made with <img src="/h.svg" alt="love"> by us</p>'), 'x.vue')
    const [sentence, alt] = result.segments
    expect([sentence!.skeleton, alt!.skeleton]).toEqual(['Made with {0} by us', 'love'])
    expect(result.code).toContain(`<template #0><img src="/h.svg" :alt="$diglot('${alt!.hash}', 'love')"></template>`)
  })

  it('should give the same text one hash, whatever its interpolations are called', async () => {
    const segments = await extract(template('<p>Save</p><button>Save</button><p>Hi {{ user.name }}</p><p>Hi {{ account.displayName }}</p>'), { file: 'x.vue' })
    expect(new Set(segments.map(s => s.hash)).size).toBe(2)
    expect(segments[2]!.sourceHash).not.toBe(segments[3]!.sourceHash)
  })

  it('should render text through `$diglot` and text with elements through `<DiglotText>`', async () => {
    const result = await rewrite(template('<p>Hi {{ name }}</p><p>Read <a :href="u">docs</a><br>now</p>'), 'x.vue')
    const [plain, rich] = result.segments
    expect(result.code).toContain(`<p>{{ $diglot('${plain!.hash}', 'Hi \\u007b0\\u007d', [(name)]) }}</p>`)
    expect(result.code).toContain(`<DiglotText h="${rich!.hash}" :s="'Read \\u007b0\\u007ddocs\\u007b/0\\u007d\\u007b1\\u007dnow'">`)
    expect(result.code).toContain('<template #0="{ __children }"><a :href="u"><component :is="__children" /></a></template><template #1><br></template>')
  })

  it('should leave an attribute that is also bound as it is', async () => {
    const code = template('<input title="Search" :title="label">')
    expect((await rewrite(code, 'x.vue')).code).toBe(code)
  })

  it('should skip text that reads as a placeholder', async () => {
    const result = await rewrite(template('<p>Use {0} here</p><p>Use {name} here</p>'), 'x.vue')
    expect(result.segments.map(s => s.skeleton)).toEqual(['Use {name} here'])
    expect(result.skipped).toEqual([{ line: 1, reason: 'text reads as a placeholder', text: 'Use {0} here' }])
  })

  it('should leave templates in other languages alone', async () => {
    expect(await transform('<template lang="pug">p Hello</template>', { file: 'x.vue' })).toBeUndefined()
  })
})

describe('react', () => {
  const component = (jsx: string) => `export default function X() { return (${jsx}); }`

  it('should make one segment per run, with expressions and inline elements as placeholders', async () => {
    expect(await skeletons(component('<><p>Hi <b>{user.name}</b>, read <a href={u}>the docs</a>.</p><h1>Title</h1></>'), 'x.tsx')).toEqual([
      'Hi {0}, read {1}the docs{/1}.',
      'Title',
    ])
  })

  it('should follow the whitespace rule of JSX', async () => {
    const result = await rewrite(component('<p>\n  One\n    two  three\n\n  four\n</p>'), 'x.tsx')
    expect(result.segments.map(s => s.skeleton)).toEqual(['One two three four'])
    expect(result.code).toContain(`s={'One two  three four'}`)
    expect(await skeletons(component('<p>\n  Read the{" "}\n  <a>docs</a>{" "}\n  now\n</p>'), 'x.tsx')).toEqual(['Read the {0}docs{/0} now'])
  })

  it('should decode entities', async () => {
    expect(await skeletons(component('<p>a&nbsp;b &amp; c &#169;</p>'), 'x.tsx')).toEqual(['a b & c ©'])
  })

  it('should walk JSX inside expressions as separate blocks', async () => {
    expect(await skeletons(component('<div>Status: {ok ? <span>good</span> : <span>bad</span>}{xs.map((x) => <li key={x}>Item {x}</li>)}{ok && <>Done</>}</div>'), 'x.tsx')).toEqual([
      'Status:',
      'good',
      'bad',
      'Item {0}',
      'Done',
    ])
  })

  it('should render runs through `DiglotText` with a part for each placeholder', async () => {
    const result = await rewrite(component('<p>Read <a href={u}>docs</a><br/>{n} times</p>'), 'x.tsx')
    expect(result.code).toContain(`<__DiglotText h="${result.segments[0]!.hash}" s={'Read \\u007b0\\u007ddocs\\u007b/0\\u007d\\u007b1\\u007d\\u007b2\\u007d times'} p={[__children => (<a href={u}>{__children}</a>), (<br/>), (n)]} />`)
    expect(result.code.startsWith(`import { DiglotText as __DiglotText, useTranslate as __useTranslate } from '@diglot/components/react';`)).toBe(true)
  })

  it('should translate attributes inside a component and leave them alone outside one', async () => {
    const result = await rewrite(`"use client";\nconst x = <img alt="Outside" />;\nconst Logo = () => <img alt="Logo" />;\nexport default function Page() { "use memo"; return <input placeholder="Search" />; }`, 'x.tsx')
    expect(result.segments.map(s => [s.context.detail, s.skeleton])).toEqual([['alt', 'Logo'], ['placeholder', 'Search']])
    expect(result.code).toContain('<img alt="Outside" />')
    expect(result.code).toContain(`const Logo = () => { const __diglot = __useTranslate(); return (<img alt={__diglot('${result.segments[0]!.hash}', 'Logo')} />); };`)
    expect(result.code).toContain('"use memo"; const __diglot = __useTranslate();')
    expect(result.code.startsWith('"use client";\nimport { DiglotText')).toBe(true)
  })

  it('should render text in `<title>` and `<option>` as a string, and other text through `DiglotText`', async () => {
    const result = await rewrite(component('<><title>Settings</title><select><option value="en">English</option><option>Hello {name}</option></select><p>Hello</p></>'), 'x.tsx')
    const [title, option] = result.segments
    expect(result.code).toContain(`<title>{__diglot('${title!.hash}', 'Settings')}</title>`)
    expect(result.code).toContain(`<option value="en">{__diglot('${option!.hash}', 'English')}</option>`)
    expect(result.code).toContain(`<option>{__diglot('${result.segments[2]!.hash}', 'Hello \\u007b0\\u007d', [(name)])}</option>`)
    expect(result.code).toContain(`<p><__DiglotText h="${result.segments[3]!.hash}" s={'Hello'} /></p>`)
  })

  it('should call the hook in components only, and warn about attributes elsewhere', async () => {
    const result = await rewrite([
      `const Columns = show => show ? [<th title="Name" />] : [];`,
      `const Search = memo(forwardRef((props, ref) => <input ref={ref} placeholder="Search" />));`,
      `class Old extends Component { render() { return <button title="Close" />; } }`,
      `export default function Table({ show }) { return <table title="Table">{Columns(show)}</table>; }`,
    ].join('\n'), 'x.tsx')
    expect(result.segments.map(s => s.skeleton)).toEqual(['Search', 'Table'])
    expect(result.code).toContain('const Columns = show => show ? [<th title="Name" />] : [];')
    expect(result.code).toContain('memo(forwardRef((props, ref) => { const __diglot = __useTranslate(); return (<input')
    expect(result.skipped.map(s => [s.reason, s.text])).toEqual([['attribute outside a component', 'Name'], ['attribute outside a component', 'Close']])
  })

  it('should not call the hook in functions passed to other functions, or in async components', async () => {
    const result = await rewrite([
      `function Row(item) { return <li title="Item">{item}</li> }`,
      `export default async function Page({ items }) { return <ul title="List">{items.map(Row)}</ul> }`,
    ].join('\n'), 'x.tsx')
    expect(result.code).not.toContain('__useTranslate()')
    expect(result.skipped.map(s => s.text)).toEqual(['Item', 'List'])
  })

  it('should read .jsx and leave modules without JSX text alone', async () => {
    expect(await skeletons(component('<p>Hello</p>'), 'x.jsx')).toEqual(['Hello'])
    expect(await extract('export const n = 1;', { file: 'x.tsx' })).toEqual([])
  })
})

describe('svelte', () => {
  it('should make one segment per run, with expressions and inline elements as placeholders', async () => {
    expect(await skeletons('<p>Hi <b>{user.name}</b>, read <a href={u}>the docs</a>.</p><h1>Title</h1>', 'x.svelte')).toEqual([
      'Hi {0}, read {1}the docs{/1}.',
      'Title',
    ])
  })

  it('should render text through the store and text with elements through `Diglot__Text` with snippets', async () => {
    const result = await rewrite('<p>Save</p><p>Go <a href={u}>home</a><br>now</p>', 'x.svelte')
    expect(result.code).toContain(`<p>{$__diglot('${result.segments[0]!.hash}', 'Save')}</p>`)
    expect(result.code).toContain('{#snippet __p0(__children)}<a href={u}>{@render __children()}</a>{/snippet}{#snippet __p1()}<br>{/snippet}</Diglot__Text>')
    expect(result.code).toMatch(/^<script>import \{ DiglotText as Diglot__Text, translate as __translate \} from '@diglot\/components\/svelte'; const __diglot = __translate\(\);<\/script>/)
  })

  it('should add its import to the end of the instance script, not to the module one', async () => {
    const result = await rewrite('<script module lang="ts">export const a = 1;</script><script lang="ts">let b: number = 2;</script><p>Hi</p>', 'x.svelte')
    expect(result.code).toContain(`<script lang="ts">let b: number = 2;\nimport { DiglotText as Diglot__Text, translate as __translate } from '@diglot/components/svelte'; const __diglot = __translate();\n</script>`)
    expect(result.code).toContain('<script module lang="ts">export const a = 1;</script>')
  })

  it('should follow the whitespace rule of the compiler', async () => {
    expect(await skeletons('<div>\n  <b>Bold</b>\n  <i>italic</i>\n</div>', 'x.svelte')).toEqual(['{0}Bold{/0} {1}italic{/1}'])
    const result = await rewrite('<div>Before\n  <div>Inner</div>\n  After</div>', 'x.svelte')
    expect(result.segments.map(s => s.skeleton)).toEqual(['Before', 'Inner', 'After'])
    expect(result.code).toContain(`'Before '`)
    expect(result.code).toContain(`' After'`)
  })

  it('should decode entities and skip text that reads as a placeholder', async () => {
    const result = await rewrite('<p>a &amp; b</p><p>Use &#123;0&#125; here</p>', 'x.svelte')
    expect(result.segments.map(s => s.skeleton)).toEqual(['a & b'])
    expect(result.skipped[0]!.reason).toBe('text reads as a placeholder')
  })

  it('should translate static attributes only, including those of elements whose content it leaves alone', async () => {
    const result = await rewrite('<img alt="Logo" src="/a.png"><input placeholder={p}><Card title="Hi" /><textarea placeholder="Bio"></textarea>', 'x.svelte')
    expect(result.segments.map(s => [s.context.detail, s.skeleton])).toEqual([['alt', 'Logo'], ['title', 'Hi'], ['placeholder', 'Bio']])
    expect(result.code).toContain(`alt={$__diglot('${result.segments[0]!.hash}', 'Logo')}`)
  })

  it('should split runs at blocks and tags, and walk the fragments of blocks', async () => {
    expect(await skeletons('<p>Status: {#if ok}good{:else}bad{/if}</p>{#each xs as x}<li>Item {x}</li>{:else}None{/each}{#await p}Wait{:then v}Got {v}{/await}<p>A {@html h} B</p>', 'x.svelte')).toEqual([
      'Status:',
      'good',
      'bad',
      'Item {0}',
      'None',
      'Wait',
      'Got {0}',
      'A',
      'B',
    ])
  })

  it('should leave a component without text untouched', async () => {
    const code = '<script>let x = 1;</script><p>{x}</p>'
    expect((await rewrite(code, 'x.svelte')).code).toBe(code)
  })
})

it('should leave other files alone', async () => {
  expect(await transform('export const a = 1', { file: 'a.ts' })).toBeUndefined()
})

describe('vue templates', () => {
  function errors(code: string, file: string, ssr: boolean): string[] {
    const { descriptor, errors } = parse(code, { filename: file })
    if (errors.length || !descriptor.template)
      return errors.map(String)
    const result = compileTemplate({ source: descriptor.template.content, filename: file, id: 'x', ssr, ssrCssVars: [], compilerOptions: { bindingMetadata: {} } })
    return result.errors.map(error => typeof error === 'string' ? error : error.message)
  }

  it.each(components(join(fixtures, 'vue')))('should still compile %s for the DOM and for the server', async (file) => {
    const code = readFileSync(join(fixtures, 'vue', file), 'utf8')
    const result = await rewrite(code, file)
    for (const ssr of [false, true])
      expect(errors(result.code, file, ssr)).toEqual(errors(code, file, ssr))
  })
})
