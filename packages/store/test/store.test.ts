import type { Segment, TranslationRecord } from '@diglot/core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build, createManifest, liveHashes, loadConfig, loadGlossary, parseBundle, parseSources, readManifest, readRecord, readRecords, readSource, recordPath, serialiseRecord, writeManifest, writeRecord } from '../src/index.ts'

const temp = () => mkdtempSync(join(tmpdir(), 'diglot-store-'))
const record = (hash: string, text = 'Bonjour'): TranslationRecord => ({ hash, source: 'Hello', text, origin: 'mt', review: 'none', derived: 'fresh', mt: { model: 'm', candidate: text }, updatedAt: '2026-11-01T00:00:00.000Z' })

describe('records', () => {
  it('should store one record per locale and hash', async () => {
    const root = temp()
    expect(recordPath('fr', '1d4e5186ed79d236')).toBe('fr/segments/1d/1d4e5186ed79d236.json')
    expect(await writeRecord(root, 'fr', record('1d4e5186ed79d236'))).toBe('fr/segments/1d/1d4e5186ed79d236.json')
    expect(await readRecord(root, 'fr', '1d4e5186ed79d236')).toEqual(record('1d4e5186ed79d236'))
    expect(await readRecord(root, 'fr', 'ffffffffffffffff')).toBeUndefined()
  })

  it('should serialise deterministically', () => {
    const shuffled = Object.fromEntries(Object.entries(record('1d4e5186ed79d236')).reverse()) as unknown as TranslationRecord
    expect(serialiseRecord(shuffled)).toBe(serialiseRecord(record('1d4e5186ed79d236')))
    expect(serialiseRecord(shuffled)).toMatchInlineSnapshot(`
      "{
        "hash": "1d4e5186ed79d236",
        "source": "Hello",
        "text": "Bonjour",
        "origin": "mt",
        "review": "none",
        "derived": "fresh",
        "mt": {
          "model": "m",
          "candidate": "Bonjour"
        },
        "updatedAt": "2026-11-01T00:00:00.000Z"
      }
      "
    `)
  })

  it('should refuse to write invalid records and detect misplaced files', async () => {
    const root = temp()
    await expect(writeRecord(root, 'fr', { ...record('1d4e5186ed79d236'), origin: 'robot' as 'mt' })).rejects.toThrow('"origin"')
    mkdirSync(join(root, 'fr/segments/aa'), { recursive: true })
    writeFileSync(join(root, 'fr/segments/aa/aaaaaaaaaaaaaaaa.json'), serialiseRecord(record('bbbbbbbbbbbbbbbb')))
    await expect(readRecords(root, 'fr')).rejects.toThrow('does not match its path')
  })

  it('should build sorted locale bundles from live records', async () => {
    const root = temp()
    for (const hash of ['bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', 'cccccccccccccccc'])
      await writeRecord(root, 'fr', record(hash))
    const [result] = await build(root, { locales: ['fr'], only: new Set(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']) })
    expect(result).toEqual({ locale: 'fr', path: 'dist/fr.json', records: 2, skipped: 1 })
    const content = readFileSync(join(root, 'dist/fr.json'), 'utf8')
    expect(Object.keys(JSON.parse(content).records)).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'])
    expect(parseBundle(content).get('aaaaaaaaaaaaaaaa')).toEqual(record('aaaaaaaaaaaaaaaa'))
    expect(() => parseBundle({ version: 1, locale: 'fr', records: { cccccccccccccccc: record('aaaaaaaaaaaaaaaa') } })).toThrow('does not match')
  })
})

describe('manifest', () => {
  it('should write one entry per line and read it back', async () => {
    const stateDir = temp()
    const segment = { hash: 'aaaaaaaaaaaaaaaa', kind: 'heading', format: 'markdown', skeleton: 'Intro', words: 1, text: 'Intro', sourceHash: 'x', placeholders: [], context: { file: 'a.md', index: 0, headingTrail: [], containers: [] }, position: { startLine: 1, endLine: 1, precision: 'node' } } as Segment
    const manifest = createManifest('main', { 'docs/b.md': [], 'docs/a.md': [segment] }, { ref: 'main', sha: 'abc' })
    const path = await writeManifest(stateDir, manifest)
    expect(readFileSync(path, 'utf8')).toBe([
      '{',
      '  "version": 1,',
      '  "source": "main",',
      '  "ref": "main",',
      '  "sha": "abc",',
      '  "files": {',
      '    "docs/a.md": [',
      '      {"hash":"aaaaaaaaaaaaaaaa","kind":"heading","format":"markdown","words":1,"skeleton":"Intro"}',
      '    ],',
      '    "docs/b.md": []',
      '  }',
      '}',
      '',
    ].join('\n'))
    expect(await readManifest(stateDir, 'main')).toEqual(manifest)
    expect(liveHashes([manifest])).toEqual(new Set(['aaaaaaaaaaaaaaaa']))
  })
})

describe('config', () => {
  it('should load diglot.config.ts and sources.yml', async () => {
    const root = temp()
    writeFileSync(join(root, 'diglot.config.ts'), 'export default { locales: [\'fr\', \'pt-BR\'], parser: \'mdast\' }\n')
    writeFileSync(join(root, 'sources.yml'), 'sources:\n  - name: nuxt-main\n    repo: nuxt/nuxt\n    ref: main\n    path: ../nuxt\n    dir: docs\n')
    const config = await loadConfig(root)
    expect(config).toMatchObject({ root, locales: ['fr', 'pt-BR'], parser: 'mdast', outDir: join(root, 'dist'), stateDir: join(root, '.diglot') })
    expect(config.sources).toEqual([{ name: 'nuxt-main', repo: 'nuxt/nuxt', ref: 'main', path: '../nuxt', dir: 'docs' }])
  })

  it('should reject malformed sources and locales', async () => {
    expect(() => parseSources('- name: a\n- name: a\n')).toThrow('duplicate')
    expect(() => parseSources('- repo: x\n')).toThrow('name')
    const root = temp()
    writeFileSync(join(root, 'diglot.config.ts'), 'export default { locales: [\'French\'] }\n')
    await expect(loadConfig(root)).rejects.toThrow('invalid locale')
  })

  it('should load glossaries', async () => {
    const root = temp()
    mkdirSync(join(root, 'fr'))
    writeFileSync(join(root, 'fr/glossary.yml'), 'terms:\n  - term: layer\n    decision: keep-gloss\n    gloss: couche\nstyle:\n  - Use tu\n')
    expect(await loadGlossary(root, 'fr')).toEqual({ terms: [{ term: 'layer', decision: 'keep-gloss', gloss: 'couche' }], style: ['Use tu'] })
    expect(await loadGlossary(root, 'ja')).toBeUndefined()
  })
})

describe('readSource', () => {
  it('should read documents at a git ref or from the working tree', async () => {
    const repo = temp()
    const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    mkdirSync(join(repo, 'docs/guide'), { recursive: true })
    writeFileSync(join(repo, 'docs/guide/a.md'), '# A\n')
    writeFileSync(join(repo, 'docs/.navigation.yml'), 'title: Docs\n')
    writeFileSync(join(repo, 'docs/skip.txt'), 'no\n')
    writeFileSync(join(repo, 'README.md'), 'outside\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    writeFileSync(join(repo, 'docs/guide/a.md'), '# A changed\n')

    const atRef = await readSource({ name: 'x', ref: 'main', path: repo, dir: 'docs' }, '/')
    expect(atRef.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(atRef.files).toEqual([{ path: 'docs/.navigation.yml', content: 'title: Docs\n' }, { path: 'docs/guide/a.md', content: '# A\n' }])
    const tree = await readSource({ name: 'x', path: repo, dir: 'docs', exclude: ['**/.navigation.yml'] }, '/')
    expect(tree.files).toEqual([{ path: 'docs/guide/a.md', content: '# A changed\n' }])
  })
})
