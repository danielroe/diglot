import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createRecord, hashSkeleton, policyFingerprint, pseudoTranslate, resolvePolicy, restorePolicy } from '@diglot/core'
import { extract as extractMdast } from '@diglot/mdast'
import { readManifest, readPolicy, writeRecord } from '@diglot/store'
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
    const policy = (await readPolicy(join(root, '.diglot')))!
    expect(manifest.policy).toBe(policyFingerprint())
    expect(restorePolicy(policy)).toEqual(resolvePolicy())

    writeFileSync(join(root, 'docs/guide/intro.md'), '---\ntitle: Introduction\n---\n\n# Welcome\n\nNuxt fetches data with `useFetch` and caches it per request.\n\nA brand new closing paragraph appears.\n')
    const diff = JSON.parse(await cli('diff', '--cwd', root, '--json'))
    const [file] = diff.docs.files
    expect(file.file).toBe('docs/guide/intro.md')
    expect(file.diff.modified.map((m: any) => [m.before.skeleton, m.after.skeleton])).toEqual([['Nuxt fetches data with {0} and caches it.', 'Nuxt fetches data with {0} and caches it per request.']])
    expect(file.diff.added.map((s: any) => s.skeleton)).toEqual(['A brand new closing paragraph appears.'])
    expect(file.diff.removed.map((s: any) => s.skeleton)).toEqual(['This paragraph goes away.'])
    expect(await cli('diff', '--cwd', root)).toContain('~ docs/guide/intro.md (+1 -1 ~1)')

    for (const entry of entries.slice(0, 2))
      await writeRecord(root, 'fr', createRecord({ segment: entry, text: pseudoTranslate(entry.skeleton, entry.format), origin: 'mt', updatedAt: '2026-11-01T00:00:00.000Z' }))
    await writeRecord(root, 'fr', createRecord({ segment: entries[2]!, text: pseudoTranslate(entries[2]!.skeleton, entries[2]!.format), origin: 'mt', review: 'rejected', rejectedBy: { by: 'danielroe', at: '2026-11-01T00:00:00.000Z' }, updatedAt: '2026-11-01T00:00:00.000Z' }))
    await writeRecord(root, 'fr', { ...createRecord({ segment: entries[3]!, text: 'Nuxt [x](https://evil.example)', origin: 'human', updatedAt: '2026-11-01T00:00:00.000Z' }), review: 'verified', verifiedBy: { by: 'danielroe', at: '2026-11-01T00:00:00.000Z' } })

    const validation = JSON.parse(await cli('validate', '--cwd', root, '--json'))
    expect(validation.checked).toBe(4)
    expect(validation.errors.map((e: any) => e.hash)).toEqual(expect.arrayContaining([entries[3]!.hash]))
    expect(process.exitCode).toBe(1)

    const status = JSON.parse(await cli('status', '--cwd', root, '--json'))
    expect(status.fr.docs.byStatus).toEqual({
      machine: { segments: 2, words: 2 },
      rejected: { segments: 2, words: 8 },
      untranslated: { segments: 1, words: 4 },
    })

    expect(await cli('status', '--cwd', root)).toContain('machine 2, rejected 2, untranslated 1')
    expect(await cli('build', '--cwd', root)).toBe('fr: 4 records (1 rejected) -> dist/fr.json\n')
    const bundle = JSON.parse(readFileSync(join(root, 'dist/fr.json'), 'utf8'))
    expect(Object.keys(bundle.records)).toHaveLength(4)
  })

  it('should extract with the parser from the configuration', async () => {
    const root = setup()
    const source = 'Read [the docs](/d){target="_blank"} now.\n'
    writeFileSync(join(root, 'docs/guide/intro.md'), source)
    writeFileSync(join(root, 'diglot.config.ts'), 'export default { locales: [\'fr\'], parser: \'satteri\' }\n')
    await cli('extract', '--cwd', root)
    const manifest = (await readManifest(join(root, '.diglot'), 'docs'))!
    const [satteri] = await extractMdast(source, { parser: 'satteri' })
    const [remark] = await extractMdast(source)
    expect(manifest.files['docs/guide/intro.md']!.map(entry => entry.hash)).toEqual([satteri!.hash])
    expect(satteri!.hash).not.toBe(remark!.hash)
  })

  it('should extract MDX files with the mdast adapter', async () => {
    const root = setup()
    const source = 'import { Card } from \'./card.astro\'\n\n# Cards\n\nRead {count} cards.\n\n<Card>Inside a card.</Card>\n'
    writeFileSync(join(root, 'docs/guide/cards.mdx'), source)
    expect(await cli('extract', '--cwd', root)).toBe('docs: 3 files, 8 segments, 8 unique hashes -> .diglot/manifest/docs.json\n')
    const manifest = (await readManifest(join(root, '.diglot'), 'docs'))!
    expect(manifest.files['docs/guide/cards.mdx']!.map(entry => entry.hash)).toEqual((await extractMdast(source, { format: 'mdx' })).map(s => s.hash))
  })

  it('should extract the components that a source includes', async () => {
    const root = setup()
    const component = '<template>\n  <p>Read the <a href="/docs">documentation</a>.</p>\n  <img alt="Logo" src="/logo.png">\n</template>\n'
    writeFileSync(join(root, 'docs/guide/Intro.vue'), component)
    writeFileSync(join(root, 'sources.yml'), 'sources:\n  - name: docs\n    path: .\n    dir: docs\n    include: [\'**/*.md\', \'**/*.vue\']\n')
    await cli('extract', '--cwd', root)
    const manifest = (await readManifest(join(root, '.diglot'), 'docs'))!
    expect(manifest.files['docs/guide/Intro.vue']).toEqual([
      { hash: hashSkeleton('Read the {0}documentation{/0}.', undefined, 'plain'), kind: 'html-block', format: 'plain', words: 3, skeleton: 'Read the {0}documentation{/0}.', placeholders: ['link'] },
      { hash: hashSkeleton('Logo', undefined, 'plain'), kind: 'prop', format: 'plain', words: 1, skeleton: 'Logo' },
    ])
  })

  it('should name the file that fails to parse', async () => {
    const root = setup()
    writeFileSync(join(root, 'docs/guide/broken.mdx'), 'Less than x<3.\n')
    await expect(cli('extract', '--cwd', root)).rejects.toThrow(/^docs\/guide\/broken\.mdx: 1:\d+: Unexpected character/)
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
