import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolvePolicy, restorePolicy, snapshotPolicy } from '@diglot/core'
import { describe, expect, it } from 'vitest'
import { readArchive } from '../src/runtime.ts'
import { chunked, gzip, tar } from './tar.ts'

const record = (hash: string) => ({ hash, source: 'Hello', text: 'Bonjour', origin: 'mt', review: 'none', derived: 'fresh', updatedAt: '2026-11-01T00:00:00.000Z' })
const manifest = { version: 1, source: 'docs', files: { 'docs/a.md': [{ hash: '1d4e5186ed79d236', kind: 'paragraph', format: 'markdown', words: 1, skeleton: 'Hello' }] } }

const files: Record<string, string> = {
  'fr/segments/1d/1d4e5186ed79d236.json': `${JSON.stringify(record('1d4e5186ed79d236'), null, 2)}\n`,
  'fr/segments/2a/2a00000000000000.json': '{ not json',
  'fr/segments/ff/1d4e5186ed79d236.json': JSON.stringify(record('1d4e5186ed79d236')),
  'fr/segments/3b/3b00000000000000.json': JSON.stringify(record('1d4e5186ed79d236')),
  'ja/segments/1d/1d4e5186ed79d236.json': JSON.stringify(record('1d4e5186ed79d236')),
  'fr/locale.yml': 'mt:\n  enabled: true\n',
  'fr/glossary.yml': 'terms: []\n',
  'glossary.yml': '- term: Nuxt\n  doNotTranslate: true\n',
  '.diglot/manifest/docs.json': JSON.stringify(manifest),
  '.diglot/manifest/other.json': JSON.stringify({ ...manifest, source: 'other' }),
  '.diglot/policy.json': JSON.stringify(snapshotPolicy()),
  'dist/fr.json': JSON.stringify({ version: 1, locale: 'fr', records: {} }),
  'README.md': '# translations\n',
}

describe('readArchive', () => {
  it('should read a GitHub-style tarball of a store', async () => {
    const sha = 'a'.repeat(40)
    const archive = await readArchive(await gzip(tar(`translations-${sha}`, files, { sha })))
    expect(archive.sha).toBe(sha)
    expect([...archive.records.keys()].sort()).toEqual(['fr', 'ja'])
    expect(Object.fromEntries(archive.records.get('fr')!)).toEqual({ '1d4e5186ed79d236': record('1d4e5186ed79d236') })
    expect([...archive.manifests.keys()].sort()).toEqual(['docs', 'other'])
    expect(archive.manifests.get('docs')).toEqual(manifest)
    expect(restorePolicy(archive.policy!)).toEqual(resolvePolicy())
    expect(Object.fromEntries(archive.files)).toEqual({ 'fr/locale.yml': files['fr/locale.yml'], 'fr/glossary.yml': files['fr/glossary.yml'], 'glossary.yml': files['glossary.yml'] })
    expect(archive.invalid).toEqual(['fr/segments/2a/2a00000000000000.json', 'fr/segments/3b/3b00000000000000.json'])
  })

  it('should read streams in any chunk size, compressed or not', async () => {
    const bytes = tar('repo', { ...files, [`${'c'.repeat(160)}.yml`]: 'y' }, { sha: 'c'.repeat(40) })
    const expected = await readArchive(bytes)
    for (const size of [1, 7, 512, 513, 4096]) {
      expect(await readArchive(chunked(bytes, size))).toEqual(expected)
      expect(await readArchive(chunked(await gzip(bytes), size))).toEqual(expected)
    }
    expect(expected.sha).toBe('c'.repeat(40))
    expect(expected.files.get(`${'c'.repeat(160)}.yml`)).toBe('y')
  })

  it('should only read the requested locales and manifests', async () => {
    const archive = await readArchive(tar('repo', files), { locales: ['ja'], manifests: ['other'] })
    expect([...archive.records.keys()]).toEqual(['ja'])
    expect([...archive.manifests.keys()]).toEqual(['other'])
  })

  it('should read long paths', async () => {
    const long = `${'a'.repeat(60)}/${'b'.repeat(60)}/glossary.yml`
    const longer = `${'c'.repeat(160)}.yml`
    for (const longNames of ['pax', 'gnu'] as const) {
      const archive = await readArchive(tar('repo', { [`${'a'.repeat(60)}/segments/1d/1d4e5186ed79d236.json`]: JSON.stringify(record('1d4e5186ed79d236')), [long]: 'x', [longer]: 'y' }, { longNames }))
      expect([...archive.records.keys()]).toEqual(['a'.repeat(60)])
      expect(Object.fromEntries(archive.files)).toEqual({ [longer]: 'y' })
    }
  })

  it('should list manifests that are not valid JSON, have no files or have another version', async () => {
    const archive = await readArchive(tar('repo', { '.diglot/manifest/a.json': '{', '.diglot/manifest/b.json': '[]', '.diglot/manifest/c.json': JSON.stringify(manifest), '.diglot/manifest/d.json': JSON.stringify({ ...manifest, version: 2 }) }))
    expect([...archive.manifests.keys()]).toEqual(['c'])
    expect(archive.invalid).toEqual(['.diglot/manifest/a.json', '.diglot/manifest/b.json', '.diglot/manifest/d.json'])
  })

  it('should read the output of `git archive`', async () => {
    const root = mkdtempSync(join(tmpdir(), 'diglot-archive-'))
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: root })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'init')
    const sha = git('rev-parse', 'HEAD').toString().trim()
    const archive = await readArchive(new Uint8Array(git('archive', '--format=tar.gz', `--prefix=translations-${sha}/`, 'HEAD')))
    expect(archive.sha).toBe(sha)
    expect([...archive.records.get('fr')!.keys()]).toEqual(['1d4e5186ed79d236'])
    expect(archive.manifests.size).toBe(2)
  })

  it('should reject a truncated archive', async () => {
    const bytes = tar('repo', files)
    for (const end of [1500, 1536, bytes.length - 1024])
      await expect(readArchive(bytes.slice(0, end))).rejects.toThrow('archive is truncated')
    await expect(readArchive((await gzip(bytes)).slice(0, 200))).rejects.toThrow()
  })

  it('should reject data that is not a tar archive', async () => {
    const page = new TextEncoder().encode('404: Not Found'.padEnd(1024))
    await expect(readArchive(page)).rejects.toThrow('invalid tar header')
    await expect(readArchive(await gzip(page))).rejects.toThrow('invalid tar header')
  })

  it('should reject with the error of the stream', async () => {
    const bytes = tar('repo', files)
    for (const data of [bytes, await gzip(bytes)]) {
      const failure = new Error('connection reset')
      let sent = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent)
            return controller.error(failure)
          sent = true
          controller.enqueue(data.slice(0, 600))
        },
      })
      await expect(readArchive(stream)).rejects.toBe(failure)
    }
  })
})
