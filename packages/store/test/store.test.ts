import type { Segment, TranslationRecord } from '@diglot/core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { policyFingerprint, snapshotPolicy } from '@diglot/core'
import { describe, expect, it } from 'vitest'
import { build, createManifest, liveHashes, loadConfig, loadGlossary, loadLocaleState, loadStyle, mergeGlossary, mtEnabled, parseBundle, parseGlossary, parseLocaleState, parseSources, parseStyle, readManifest, readPolicy, readRecord, readRecords, readSource, recordPath, serialiseRecord, writeManifest, writePolicy, writeRecord } from '../src/index.ts'

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
    await expect(writeRecord(root, 'fr', { ...record('1d4e5186ed79d236'), review: 'rejected' })).rejects.toThrow('"rejectedBy"')
    mkdirSync(join(root, 'fr/segments/aa'), { recursive: true })
    writeFileSync(join(root, 'fr/segments/aa/aaaaaaaaaaaaaaaa.json'), serialiseRecord(record('bbbbbbbbbbbbbbbb')))
    await expect(readRecords(root, 'fr')).rejects.toThrow('does not match its path')
  })

  it('should build sorted locale bundles from live records', async () => {
    const root = temp()
    for (const hash of ['bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', 'cccccccccccccccc'])
      await writeRecord(root, 'fr', record(hash))
    const rejected: TranslationRecord = { ...record('bbbbbbbbbbbbbbbb'), review: 'rejected', rejectedBy: { by: 'danielroe', at: '2026-11-02T00:00:00.000Z' } }
    await writeRecord(root, 'fr', rejected)
    const [result] = await build(root, { locales: ['fr'], only: new Set(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']) })
    expect(result).toEqual({ locale: 'fr', path: 'dist/fr.json', records: 2, rejected: 1, skipped: 1 })
    const content = readFileSync(join(root, 'dist/fr.json'), 'utf8')
    expect(Object.keys(JSON.parse(content).records)).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'])
    expect(parseBundle(content).get('aaaaaaaaaaaaaaaa')).toEqual(record('aaaaaaaaaaaaaaaa'))
    expect(parseBundle(content).get('bbbbbbbbbbbbbbbb')).toEqual(rejected)
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

  it('should record the policy fingerprint and write the policy snapshot', async () => {
    const stateDir = temp()
    expect(createManifest('main', {}, { policy: policyFingerprint() }).policy).toBe(policyFingerprint())
    expect(await readPolicy(stateDir)).toBeUndefined()
    expect(await writePolicy(stateDir, { codeComments: false })).toBe(join(stateDir, 'policy.json'))
    expect(await readPolicy(stateDir)).toEqual(snapshotPolicy({ codeComments: false }))
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

  it('should read x18n glossaries and merge them below the locale glossary', async () => {
    const root = temp()
    mkdirSync(join(root, 'fr'))
    writeFileSync(join(root, 'glossary.yml'), [
      '- term: Nuxt',
      '  doNotTranslate: true',
      '- term: composable',
      '  translations: { fr: composable, ja: コンポーザブル }',
      '- term: hydration',
      '  translations: { fr: hydratation, pt_BR: hidratação }',
      '- term: key',
      '  note: A message identifier',
      '- term: layer',
      '  translations: { fr: layer }',
    ].join('\n'))
    writeFileSync(join(root, 'fr/glossary.yml'), 'terms:\n  - term: Layer\n    decision: keep-gloss\n    gloss: couche\n')
    expect(await loadGlossary(root, 'fr', { shared: 'glossary.yml' })).toEqual({ terms: [
      { term: 'Nuxt', decision: 'keep' },
      { term: 'composable', decision: 'keep' },
      { term: 'hydration', decision: 'translate', target: 'hydratation' },
      { term: 'key', decision: 'translate', note: 'A message identifier' },
      { term: 'Layer', decision: 'keep-gloss', gloss: 'couche' },
    ] })
    expect((await loadGlossary(root, 'pt-BR', { shared: 'glossary.yml' }))!.terms[2]).toEqual({ term: 'hydration', decision: 'translate', target: 'hidratação' })
    expect(parseGlossary({ glossary: [{ term: 'x18n', doNotTranslate: true }], locales: ['en'] }, 'fr')).toEqual({ terms: [{ term: 'x18n', decision: 'keep' }] })
    expect(() => parseGlossary({ terms: [{ term: 'a', decision: 'keep-gloss' }] }, 'fr')).toThrow('decision')
    const config = await loadConfig(root)
    expect(config.glossary).toBe(join(root, 'glossary.yml'))
  })

  it('should load style rules', async () => {
    const root = temp()
    mkdirSync(join(root, 'fr'))
    writeFileSync(join(root, 'fr/style.yml'), 'rules:\n  - Use vous\ntypography:\n  spaceBefore: ";:!?"\nlengthRatio: [0.8, 1.8]\n')
    expect(await loadStyle(root, 'fr')).toEqual({ rules: ['Use vous'], typography: { spaceBefore: ';:!?' }, lengthRatio: [0.8, 1.8] })
    expect(await loadStyle(root, 'ja')).toBeUndefined()
    writeFileSync(join(root, 'fr/style.yml'), 'lengthRatio: 2\n')
    await expect(loadStyle(root, 'fr')).rejects.toThrow('lengthRatio')
    writeFileSync(join(root, 'diglot.config.ts'), 'import { defineConfig } from \'@diglot/core\'\n\nexport default defineConfig({ locales: [\'fr\'], mt: { model: \'m\' } })\n')
    const config = await loadConfig(root)
    expect(config.mt).toEqual({ model: 'm' })
    expect(config.glossary).toBeUndefined()
  })

  it('should load per-locale state', async () => {
    const root = temp()
    mkdirSync(join(root, 'fr'))
    mkdirSync(join(root, 'ja'))
    writeFileSync(join(root, 'fr/locale.yml'), 'mt:\n  enabled: true\ngovernance:\n  activeReviewers: [danielroe]\n  approvalRate: 0.62\n  reviewLatencyDays: 9\n')
    writeFileSync(join(root, 'ja/locale.yml'), 'mt:\n  enabled: false\n')
    const fr = await loadLocaleState(root, 'fr')
    expect(fr).toEqual({ mt: { enabled: true }, governance: { activeReviewers: ['danielroe'], approvalRate: 0.62, reviewLatencyDays: 9 } })
    expect([mtEnabled(fr), mtEnabled(await loadLocaleState(root, 'ja')), mtEnabled(await loadLocaleState(root, 'de'))]).toEqual([true, false, false])
    writeFileSync(join(root, 'ja/locale.yml'), 'mt:\n  enabled: yes please\n')
    await expect(loadLocaleState(root, 'ja')).rejects.toThrow('mt.enabled')
  })

  it('should parse and merge locale files without a file system', () => {
    expect(parseLocaleState(null)).toEqual({})
    expect(parseLocaleState({ mt: { enabled: true } })).toEqual({ mt: { enabled: true } })
    expect(() => parseLocaleState('enabled', 'fr/locale.yml')).toThrow('fr/locale.yml: must be a mapping')
    expect(() => parseLocaleState({ governance: { approvalRate: 'high' } })).toThrow('governance.approvalRate')
    expect(parseStyle({ lengthRatio: [0.8, 1.8] })).toEqual({ lengthRatio: [0.8, 1.8] })
    expect(() => parseStyle({ rules: 'Use vous' })).toThrow('rules')
    const shared = { terms: [{ term: 'Nuxt', decision: 'keep' as const }, { term: 'layer', decision: 'keep' as const }], style: ['shared'] }
    const own = { terms: [{ term: 'Layer', decision: 'keep-gloss' as const, gloss: 'couche' }] }
    expect(mergeGlossary(shared, own)).toEqual({ terms: [shared.terms[0], own.terms[0]] })
    expect(mergeGlossary(shared, { ...own, style: ['own'] })!.style).toEqual(['own'])
    expect(mergeGlossary(undefined, undefined)).toBeUndefined()
  })
})

describe('readSource', () => {
  it('should read documents at a git ref or from the working tree', async () => {
    const repo = temp()
    const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=diglot-test', '-c', 'user.email=test@diglot.invalid', ...args], { cwd: repo, encoding: 'utf8' })
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
