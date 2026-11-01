import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
})
