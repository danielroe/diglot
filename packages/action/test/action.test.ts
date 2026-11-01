import type { TranslationRecord } from '@diglot/core'
import type { RunOptions } from '../src/index.ts'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recordStatus } from '@diglot/core'
import { loadConfig, loadGlossary, loadLocaleState, loadStyle, mtEnabled, writeRecord } from '@diglot/store'
import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitMessage, outputs, run, summary } from '../src/index.ts'

const temp = (name: string) => mkdtempSync(join(tmpdir(), `diglot-action-${name}-`))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' }).trim()
}

function write(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

const PAGE = `---
title: Layers
---

# Layers

Layers let you extend a [Nuxt](https://nuxt.com) application.

Use \`extends\` in your configuration to add a layer.

This paragraph will be removed.

Refuse this sentence.
`

/** A mock model that marks translations with ` FR` and refuses segments containing "Refuse". */
function translator() {
  const calls: Array<'translate' | 'update'> = []
  const model = new MockLanguageModelV4({
    modelId: 'mock/model',
    async doGenerate({ prompt }) {
      const system = prompt.find(m => m.role === 'system')!.content as string
      const user = prompt.filter(m => m.role === 'user').flatMap(m => m.content.map(p => p.type === 'text' ? p.text : '')).join('\n')
      let answer: unknown
      if (system.startsWith('You maintain')) {
        calls.push('update')
        answer = { text: `${/New source:\n(.*)\n/.exec(user)![1]} FR` }
      }
      else {
        calls.push('translate')
        const segments = JSON.parse(user.slice(user.indexOf('\n[') + 1)) as Array<{ id: string, text: string }>
        answer = { translations: segments.map(s => ({ id: s.id, text: s.text.includes('Refuse') ? '[refusé](https://example.com)' : `${s.text} FR` })) }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        providerMetadata: { gateway: { cost: '0.001' } },
        warnings: [],
      }
    },
  })
  return { model, calls }
}

function setup() {
  const upstream = temp('upstream')
  git(upstream, 'init', '-q', '-b', 'main')
  write(upstream, { 'docs/1.guide/layers.md': PAGE, 'README.md': 'not docs\n' })
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-q', '-m', 'docs')

  const root = temp('translations')
  git(root, 'init', '-q', '-b', 'main')
  write(root, {
    'diglot.config.ts': `export default { locales: ['fr', 'ja'] }\n`,
    'fr/locale.yml': 'mt:\n  enabled: true\n',
    'ja/locale.yml': 'mt:\n  enabled: false\n',
    'sources.yml': `sources:\n  - name: docs\n    repo: example/docs\n    ref: main\n    path: ${upstream}\n    dir: docs\n`,
    'fr/glossary.yml': 'terms:\n  - term: Nuxt\n    decision: keep\n',
    '.gitignore': '.diglot/checkouts/\n',
  })
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'init')
  return { upstream, root }
}

const records = (root: string, locale = 'fr') => JSON.parse(readFileSync(join(root, `dist/${locale}.json`), 'utf8')).records as Record<string, TranslationRecord>

describe('run', () => {
  beforeEach(() => {
    const empty = join(temp('gitconfig'), 'config')
    writeFileSync(empty, '')
    vi.stubEnv('GIT_CONFIG_GLOBAL', empty)
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  })

  it('should translate, update, carry and commit once per run, and do nothing when sources are unchanged', async () => {
    const { upstream, root } = setup()
    const { model, calls } = translator()
    const options: RunOptions = { cwd: root, model, author: { name: 'bot', email: 'bot@example.com' }, now: () => new Date('2026-11-01T00:00:00Z') }

    const first = await run(options)
    expect(first.totals).toEqual({ translated: 5, updated: 0, carried: 0, rejected: 1, costUsd: 0.002 })
    expect(first.locales.map(l => [l.locale, l.enabled])).toEqual([['fr', true], ['ja', false]])
    expect(first.message).toBe(`chore(fr): translate 5 segments, update 0, carry 0\n\nrejected: fr 1\nsources: docs@${git(upstream, 'rev-parse', 'HEAD').slice(0, 10)}`)
    expect(git(root, 'log', '-1', '--format=%an <%ae> %s')).toBe('bot <bot@example.com> chore(fr): translate 5 segments, update 0, carry 0')
    expect(first.sha).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(Object.values(records(root)).map(r => r.text)).toContain('Use {0} in your configuration to add a layer. FR')
    expect(Object.values(records(root))[0]).toMatchObject({ origin: 'mt', review: 'none', derived: 'fresh', mt: { model: 'mock/model', promptVersion: '1' } })
    expect(records(root, 'ja')).toEqual({})
    const rejected = first.locales[0]!.rejections[0]!
    expect(rejected.file).toBe('docs/1.guide/layers.md')
    expect(JSON.parse(readFileSync(join(root, '.diglot/rejected/fr.json'), 'utf8'))).toEqual({ [rejected.hash]: ['grammar: link syntax', 'grammar: link syntax', 'grammar: bare URL would autolink'] })
    const callsAfterFirst = calls.length

    const second = await run(options)
    expect(second).toMatchObject({ changed: false, totals: { translated: 0, updated: 0, carried: 0, rejected: 0 } })
    expect(second.sha).toBeUndefined()
    expect(calls.length).toBe(callsAfterFirst)

    const before = records(root)
    const intro = Object.values(before).find(r => r.source.startsWith('Layers let'))!
    await writeRecord(root, 'fr', { ...intro, text: 'Les layers étendent une application {0}Nuxt{/0}.', origin: 'human', review: 'edited', by: 'translator' })
    write(root, { 'diglot.config.ts': `export default { locales: ['fr', 'ja'], policy: { salt: ({ skeleton }) => skeleton.startsWith('Layers let') ? 'intro' : undefined } }\n` })
    git(root, 'commit', '-q', '-am', 'human edit and salt')
    write(upstream, {
      'docs/1.guide/layers.md': PAGE
        .replace('[Nuxt](https://nuxt.com)', '[Nuxt](https://nuxt.com/docs)')
        .replace('Use `extends` in your configuration to add a layer.', 'Use `extends` in your configuration to add one or more layers.')
        .replace('# Layers', '# layers!')
        .replace('This paragraph will be removed.\n\n', '')
        .concat('\nA brand new paragraph about layers.\n'),
    })
    git(upstream, 'commit', '-q', '-am', 'edit')

    const third = await run(options)
    expect(third.totals).toMatchObject({ translated: 1, updated: 2, carried: 1, rejected: 0 })
    expect(third.sources[0]).toMatchObject({ added: 1, removed: 1, modified: 3 })
    expect(third.message!.split('\n')[0]).toBe('chore(fr): translate 1 segments, update 2, carry 1')
    const after = records(root)
    const updated = Object.values(after).filter(r => r.derived === 'update')
    expect(updated.map(r => r.text).sort()).toEqual(['Use {0} in your configuration to add one or more layers. FR', 'layers! FR'])
    expect(updated.every(r => r.origin === 'mt' && r.review === 'none')).toBe(true)
    expect(updated.map(r => before[r.prev!]!.source).sort()).toEqual(['Layers', 'Use {0} in your configuration to add a layer.'])
    const carried = Object.values(after).find(r => r.derived === 'carry')!
    expect(carried).toMatchObject({ source: intro.source, text: 'Les layers étendent une application {0}Nuxt{/0}.', origin: 'human', review: 'none', prev: intro.hash, salt: 'intro', mt: intro.mt })
    expect(recordStatus(carried)).toBe('pending-review')
    expect(Object.keys(after)).not.toContain(Object.keys(before).find(h => before[h]!.source === 'This paragraph will be removed.'))
    expect(existsSync(join(root, 'fr/segments', intro.hash.slice(0, 2), `${intro.hash}.json`))).toBe(true)

    expect((await run(options)).changed).toBe(false)
  })

  it('should defer work beyond the limit to later runs', async () => {
    const { root } = setup()
    const { model } = translator()
    const first = await run({ cwd: root, model, limit: 2 })
    expect(first.locales[0]).toMatchObject({ translated: 2, deferred: 4 })
    const second = await run({ cwd: root, model })
    expect(second.locales[0]).toMatchObject({ translated: 3, rejected: 1, deferred: 0 })
  })

  it('should report changes without committing when asked', async () => {
    const { root } = setup()
    const { model } = translator()
    const result = await run({ cwd: root, model, commit: false })
    expect(result.changed).toBe(true)
    expect(result.sha).toBeUndefined()
    expect(git(root, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('should fetch sources into bare checkouts and leave them out of the commit', async () => {
    const { upstream, root } = setup()
    write(root, { 'sources.yml': 'sources:\n  - name: docs\n    repo: example/docs\n    ref: main\n    dir: docs\n' })
    git(root, 'rm', '-q', '--cached', '.gitignore')
    rmSync(join(root, '.gitignore'))
    git(root, 'commit', '-q', '-am', 'remote source')
    const { model } = translator()
    const result = await run({ cwd: root, model, cloneUrl: repo => repo === 'example/docs' ? upstream : '' })
    expect(result.sources[0]!.sha).toBe(git(upstream, 'rev-parse', 'HEAD'))
    expect(existsSync(join(root, '.diglot/checkouts/example/docs/HEAD'))).toBe(true)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').some(p => p.includes('checkouts'))).toBe(false)
  })

  it('should skip locales with machine translation disabled', async () => {
    const { root } = setup()
    write(root, { 'fr/locale.yml': 'mt:\n  enabled: false\ngovernance:\n  approvalRate: 0.31\n' })
    git(root, 'commit', '-q', '-am', 'disable')
    const result = await run({ cwd: root })
    expect(result.locales).toEqual([expect.objectContaining({ locale: 'fr', enabled: false, translated: 0 }), expect.objectContaining({ locale: 'ja', enabled: false })])
    expect(result.message).toMatch(/^chore: sync docs@/)
  })
})

describe('nuxt example', () => {
  it('should load the config, sources, glossary and style', async () => {
    const root = fileURLToPath(new URL('../../../examples/nuxt', import.meta.url))
    const config = await loadConfig(root)
    expect(config.sources.map(s => `${s.repo}@${s.ref}`)).toEqual(['nuxt/nuxt@main', 'nuxt/nuxt@4.x', 'nuxt/nuxt@3.x', 'nuxt/cli@main', 'nuxt/fonts@main'])
    expect(mtEnabled(await loadLocaleState(root, 'fr'))).toBe(true)
    const glossary = (await loadGlossary(root, 'fr', { shared: config.glossary }))!
    expect(glossary.terms.find(t => t.term === 'layer')).toMatchObject({ decision: 'keep-gloss', gloss: 'couche' })
    expect(glossary.terms.find(t => t.term === 'composable')).toMatchObject({ decision: 'keep' })
    expect(glossary.terms.find(t => t.term === 'component')).toMatchObject({ decision: 'translate', target: 'composant' })
    expect(await loadStyle(root, 'fr')).toMatchObject({ typography: { spaceBefore: ';:!?»', spaceAfter: '«' } })
  })
})

describe('reporting', () => {
  it('should format outputs, the job summary and multi-locale commit messages', () => {
    const usage = { requests: 2, inputTokens: 100, outputTokens: 50, costUsd: 0.01 }
    const locale = (code: string, n: number) => ({ locale: code, enabled: true, translated: n, updated: 1, carried: 2, rejected: 0, deferred: 0, usage, rejections: [] })
    const result = {
      sources: [{ name: 'docs', sha: 'a'.repeat(40), previous: 'b'.repeat(40), segments: 10, added: 1, removed: 0, modified: 1 }],
      locales: [locale('fr', 3), { ...locale('ja', 0), rejected: 1, rejections: [{ hash: 'abc', file: 'a.md', issues: [{ check: 'grammar' as const, severity: 'error' as const, message: 'link | syntax' }] }] }],
      totals: { translated: 3, updated: 2, carried: 4, rejected: 1, costUsd: 0.02 },
      changed: true,
      message: 'chore(fr, ja): translate 3 segments, update 2, carry 4',
      sha: 'c'.repeat(40),
    }
    expect(outputs(result)).toEqual({ translated: '3', updated: '2', carried: '4', rejected: '1', costUsd: '0.02', committed: 'true', sha: 'c'.repeat(40) })
    expect(summary(result)).toContain('| fr | on | 3 | 1 | 2 | 0 | 0 | 2 | 100 / 50 | 0.0100 |')
    expect(summary(result)).toContain('| docs | bbbbbbbbbb..aaaaaaaaaa | 10 | 1 | 0 | 1 |')
    expect(summary(result)).toContain('| ja | `abc` | a.md | grammar: link \\| syntax |')
    expect(commitMessage(result.locales, result.sources)).toBe(`chore(fr, ja): translate 3 segments, update 2, carry 4\n\nfr: translate 3, update 1, carry 2\nja: translate 0, update 1, carry 2\nrejected: ja 1\nsources: docs@aaaaaaaaaa`)
  })
})
