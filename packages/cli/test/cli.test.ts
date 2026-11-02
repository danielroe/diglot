import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createRecord, pseudoTranslate } from '@diglot/core'
import { readManifest, writeRecord } from '@diglot/store'
import { runCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/index.ts'

async function cli(...rawArgs: string[]): Promise<string> {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk))
    return true
  })
  try {
    await runCommand(main, { rawArgs })
  }
  finally {
    spy.mockRestore()
  }
  return chunks.join('')
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'diglot-cli-'))
  mkdirSync(join(root, 'docs/guide'), { recursive: true })
  writeFileSync(join(root, 'docs/guide/intro.md'), '---\ntitle: Introduction\n---\n\n# Welcome\n\nNuxt fetches data with `useFetch` and caches it.\n\nThis paragraph goes away.\n')
  writeFileSync(join(root, 'docs/.navigation.yml'), 'title: Guide\n')
  writeFileSync(join(root, 'diglot.config.ts'), 'export default { locales: [\'fr\'] }\n')
  writeFileSync(join(root, 'sources.yml'), 'sources:\n  - name: docs\n    path: .\n    dir: docs\n')
  return root
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', ...args], { cwd, encoding: 'utf8' }).trim()
}

function checkoutSetup() {
  const upstream = mkdtempSync(join(tmpdir(), 'diglot-cli-upstream-'))
  git(upstream, 'init', '-q', '-b', 'main')
  mkdirSync(join(upstream, 'docs/guide'), { recursive: true })
  writeFileSync(join(upstream, 'docs/guide/intro.md'), '# Intro\n\nMain intro.\n')
  writeFileSync(join(upstream, 'docs/api.md'), '# API\n\nMain api.\n')
  writeFileSync(join(upstream, 'docs/.navigation.yml'), 'title: Main\n')
  writeFileSync(join(upstream, 'docs/secret.md'), 'secret\n')
  writeFileSync(join(upstream, 'README.md'), 'readme\n')
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-q', '-m', 'main')

  git(upstream, 'checkout', '-q', '-b', 'other')
  rmSync(join(upstream, 'docs/api.md'))
  writeFileSync(join(upstream, 'docs/guide/intro.md'), '# Intro\n\nOther intro.\n')
  writeFileSync(join(upstream, 'docs/guide/other.md'), '# Other\n\nOther only.\n')
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-q', '-m', 'other')

  const bare = mkdtempSync(join(tmpdir(), 'diglot-cli-bare-'))
  git(tmpdir(), 'clone', '-q', '--bare', upstream, bare)

  const root = mkdtempSync(join(tmpdir(), 'diglot-cli-root-'))
  writeFileSync(join(root, 'diglot.config.ts'), 'export default { locales: [\'fr\'] }\n')
  const writeSources = (ref: string) => writeFileSync(join(root, 'sources.yml'), [
    'sources:',
    '  - name: docs',
    '    repo: example/docs',
    `    ref: ${ref}`,
    `    path: ${bare}`,
    '    dir: docs',
    '    include:',
    '      - "**/*.md"',
    '      - "**/.navigation.yml"',
    '    exclude:',
    '      - "**/secret.md"',
    '',
  ].join('\n'))
  writeSources('main')
  return { bare, root, writeSources }
}

function workingTreeSetup() {
  const work = mkdtempSync(join(tmpdir(), 'diglot-cli-work-'))
  git(work, 'init', '-q', '-b', 'main')
  mkdirSync(join(work, 'docs'), { recursive: true })
  writeFileSync(join(work, 'docs/readme.md'), '# Readme\n\nWorking copy.\n')
  git(work, 'add', '.')
  git(work, 'commit', '-q', '-m', 'docs')

  const root = mkdtempSync(join(tmpdir(), 'diglot-cli-root-'))
  writeFileSync(join(root, 'diglot.config.ts'), 'export default { locales: [\'fr\'] }\n')
  writeFileSync(join(root, 'sources.yml'), `sources:\n  - name: docs\n    path: ${work}\n    dir: docs\n`)
  return { work, root }
}

afterEach(() => {
  process.exitCode = undefined
})

describe('diglot', () => {
  it('should extract, diff, validate, build and report status', async () => {
    const root = setup()
    expect(await cli('extract', '--cwd', root)).toBe('docs: 2 files, 5 segments, 5 unique hashes -> .diglot/manifest/docs.json\n')
    const manifest = (await readManifest(join(root, '.diglot'), 'docs'))!
    const entries = Object.values(manifest.files).flat()

    writeFileSync(join(root, 'docs/guide/intro.md'), '---\ntitle: Introduction\n---\n\n# Welcome\n\nNuxt fetches data with `useFetch` and caches it per request.\n\nA brand new closing paragraph appears.\n')
    const diff = JSON.parse(await cli('diff', '--cwd', root, '--json'))
    const [file] = diff.docs.files
    expect(file.file).toBe('docs/guide/intro.md')
    expect(file.diff.modified.map((m: any) => [m.before.skeleton, m.after.skeleton])).toEqual([['Nuxt fetches data with {0} and caches it.', 'Nuxt fetches data with {0} and caches it per request.']])
    expect(file.diff.added.map((s: any) => s.skeleton)).toEqual(['A brand new closing paragraph appears.'])
    expect(file.diff.removed.map((s: any) => s.skeleton)).toEqual(['This paragraph goes away.'])
    expect(await cli('diff', '--cwd', root)).toContain('~ docs/guide/intro.md (+1 -1 ~1)')

    for (const entry of entries.slice(0, 3))
      await writeRecord(root, 'fr', createRecord({ segment: entry, text: pseudoTranslate(entry.skeleton, entry.format), origin: 'mt', updatedAt: '2026-11-01T00:00:00.000Z' }))
    await writeRecord(root, 'fr', { ...createRecord({ segment: entries[3]!, text: 'Nuxt [x](https://evil.example)', origin: 'human', updatedAt: '2026-11-01T00:00:00.000Z' }), review: 'verified', verifiedBy: { by: 'danielroe', at: '2026-11-01T00:00:00.000Z' } })

    const validation = JSON.parse(await cli('validate', '--cwd', root, '--json'))
    expect(validation.checked).toBe(4)
    expect(validation.errors.map((e: any) => e.hash)).toEqual(expect.arrayContaining([entries[3]!.hash]))
    expect(process.exitCode).toBe(1)

    const status = JSON.parse(await cli('status', '--cwd', root, '--json'))
    expect(status.fr.docs.byStatus).toEqual({
      machine: { segments: 3, words: 3 },
      rejected: { segments: 1, words: 7 },
      untranslated: { segments: 1, words: 4 },
    })

    expect(await cli('build', '--cwd', root)).toBe('fr: 4 records -> dist/fr.json\n')
    const bundle = JSON.parse(readFileSync(join(root, 'dist/fr.json'), 'utf8'))
    expect(Object.keys(bundle.records)).toHaveLength(4)
  })

  it('should fail on an unknown source', async () => {
    const root = setup()
    await expect(cli('extract', '--cwd', root, '--source', 'nope')).rejects.toThrow('unknown source "nope"')
  })

  it('should export a source at its ref into .diglot/sources', async () => {
    const { bare, root, writeSources } = checkoutSetup()
    const main = git(bare, 'rev-parse', 'main')

    expect(await cli('checkout', '--cwd', root)).toBe(`docs: ${main}\n`)

    const exports = join(root, '.diglot/sources/docs/docs')
    expect(readFileSync(join(exports, 'guide/intro.md'), 'utf8')).toContain('Main intro.')
    expect(readFileSync(join(exports, 'api.md'), 'utf8')).toContain('Main api.')
    expect(existsSync(join(exports, 'guide/other.md'))).toBe(false)
    expect(existsSync(join(exports, 'secret.md'))).toBe(false)
    expect(existsSync(join(root, '.diglot/sources/docs/README.md'))).toBe(false)

    writeFileSync(join(exports, 'guide/stale.md'), 'stale\n')
    expect(await cli('checkout', '--cwd', root)).toBe(`docs: ${main}\n`)
    expect(existsSync(join(exports, 'guide/stale.md'))).toBe(false)
    expect(readFileSync(join(exports, 'guide/intro.md'), 'utf8')).toContain('Main intro.')

    writeSources('other')
    const other = git(bare, 'rev-parse', 'other')
    expect(await cli('checkout', '--cwd', root)).toBe(`docs: ${other}\n`)
    expect(readFileSync(join(exports, 'guide/intro.md'), 'utf8')).toContain('Other intro.')
    expect(existsSync(join(exports, 'api.md'))).toBe(false)
    expect(readFileSync(join(exports, 'guide/other.md'), 'utf8')).toContain('Other only.')
  })

  it('should export a local source without a ref', async () => {
    const { work, root } = workingTreeSetup()
    expect(await cli('checkout', '--cwd', root)).toBe(`docs: ${git(work, 'rev-parse', 'HEAD')}\n`)
    expect(readFileSync(join(root, '.diglot/sources/docs/docs/readme.md'), 'utf8')).toContain('Working copy.')
  })

  it('should refuse a source name that escapes the sources directory', async () => {
    const { bare, root } = checkoutSetup()
    writeFileSync(join(root, 'sources.yml'), `sources:\n  - name: ..\n    repo: example/docs\n    ref: main\n    path: ${bare}\n`)
    await expect(cli('checkout', '--cwd', root)).rejects.toThrow('must resolve inside')
  })
})
