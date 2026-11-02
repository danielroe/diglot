import type { TranslationRecord } from '@diglot/core'
import type { HistoryContext, Resource, ReviewComment } from '@x18n/core'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extract, parse } from '@diglot/comark'
import { createRecord, hashSkeleton } from '@diglot/core'
import { createManifest, recordPath, serialiseRecord, writeManifest, writeRecord } from '@diglot/store'
import { createMemoryHost } from '@x18n/core'
import { loadWorkspace } from '@x18n/node'
import { describe, expect, it } from 'vitest'
import { editRecord, recordFormat, serialiseRaw } from '../src/format.ts'
import { glossaryEntries } from '../src/glossary.ts'
import { recordHistory } from '../src/history.ts'
import { findPlaceholders, structureErrors } from '../src/placeholders.ts'
import { reviewRecord } from '../src/reviews.ts'
import { createState } from '../src/state.ts'

const plugin = fileURLToPath(new URL('../src/index.ts', import.meta.url))

function record(fields: Partial<TranslationRecord> = {}): TranslationRecord {
  return {
    hash: hashSkeleton('Hello {0}world{/0}'),
    source: 'Hello {0}world{/0}',
    text: 'Bonjour {0}le monde{/0}',
    origin: 'mt',
    review: 'none',
    derived: 'fresh',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...fields,
  }
}

const guide = `---
title: Getting started
---

# Introduction

Nuxt is powered by [Nitro](https://nitro.build).

| Name | Description |
| --- | --- |
| Alpha | First letter |
`

async function store() {
  const root = mkdtempSync(join(tmpdir(), 'diglot-x18n-'))
  mkdirSync(join(root, 'sources/docs'), { recursive: true })
  writeFileSync(join(root, 'sources/docs/guide.md'), guide)
  writeFileSync(join(root, 'diglot.config.mjs'), 'export default { locales: [\'fr\'] }\n')
  writeFileSync(join(root, 'sources.yml'), 'sources:\n  - name: docs\n    path: sources/docs\n')
  writeFileSync(join(root, 'x18n.config.mjs'), `import diglot from ${JSON.stringify(plugin)}\nexport default { plugins: [diglot()] }\n`)
  const { segments } = await extract(await parse(guide), { file: 'guide.md' })
  await writeManifest(join(root, '.diglot'), createManifest('docs', { 'guide.md': segments }))
  const bySkeleton = new Map(segments.map(s => [s.skeleton, s]))
  const paragraph = bySkeleton.get('Nuxt is powered by {0}Nitro{/0}.')!
  const previous = createRecord({ segment: { hash: hashSkeleton('Nuxt runs on {0}Nitro{/0}.'), skeleton: 'Nuxt runs on {0}Nitro{/0}.' }, text: 'Nuxt tourne sur {0}Nitro{/0}.', origin: 'human', review: 'edited', updatedAt: '2026-09-01T00:00:00.000Z' })
  await writeRecord(root, 'fr', previous)
  await writeRecord(root, 'fr', createRecord({ segment: paragraph, text: 'Nuxt est propulsé par {0}Nitro{/0}.', origin: 'mt', prev: previous.hash, updatedAt: '2026-10-01T00:00:00.000Z' }))
  await writeRecord(root, 'fr', createRecord({ segment: bySkeleton.get('Introduction')!, text: 'Introduction', origin: 'human', review: 'verified', verifiedBy: { by: 'atinux', at: '2026-10-02T00:00:00.000Z' } }))
  await writeRecord(root, 'fr', createRecord({ segment: bySkeleton.get('First letter')!, text: 'Première [lettre](https://example.com)', origin: 'mt' }))
  return { root, segments: bySkeleton, previous }
}

describe('record format', () => {
  const format = recordFormat(createState())
  const ctx = { path: 'fr/segments/aa/a.json', locale: 'fr', namespace: undefined, indent: 2 as const }

  it('should read a record as one message keyed by hash', () => {
    const text = serialiseRecord(record())
    const { tree, ranges } = format.parse(text, ctx)
    expect(tree).toEqual({ [record().hash]: 'Bonjour {0}le monde{/0}' })
    const range = ranges!.get(record().hash)!
    expect(text.slice(range.value.start, range.value.end)).toBe('"Bonjour {0}le monde{/0}"')
    expect(text.slice(range.key.start, range.key.end)).toBe(`"${record().hash}"`)
  })

  it('should mark an edited translation and keep unknown fields', () => {
    const text = `${JSON.stringify({ ...record({ review: 'verified', verifiedBy: { by: 'atinux', at: '2026-10-02T00:00:00.000Z' } }), note: 'keep me' }, null, 2)}\n`
    const [edit] = format.edit!(text, [{ type: 'set', path: [record().hash], value: 'Salut {0}le monde{/0}' }], ctx)
    const written = JSON.parse(edit!.text)
    expect(written).toMatchObject({ text: 'Salut {0}le monde{/0}', review: 'edited', note: 'keep me' })
    expect(written.verifiedBy).toBeUndefined()
    expect(Object.keys(written).at(-1)).toBe('note')
  })

  it('should refuse keys of other records and deletes', () => {
    const text = serialiseRecord(record())
    expect(() => format.edit!(text, [{ type: 'set', path: ['0000000000000000'], value: 'x' }], ctx)).toThrow('only holds')
    expect(() => format.edit!(text, [{ type: 'delete', path: [record().hash] }], ctx)).toThrow('removed with diglot')
  })

  it('should leave an unchanged record alone', () => {
    const raw = { ...record() } as Record<string, unknown>
    expect(editRecord(raw, raw.text as string)).toBe(raw)
    expect(serialiseRaw(raw)).toBe(serialiseRecord(record()))
  })
})

describe('placeholders', () => {
  it('should find atomic and paired placeholders, skipping escaped braces', () => {
    expect(findPlaceholders('Use {0} with {1}links{/1} and \\{2}').map(p => p.name)).toEqual(['0', '1', '/1'])
  })

  it('should report paired placeholders that cross emphasis', () => {
    expect(structureErrors('**{0}text**{/0}')).toContain('{/0} closes across **')
    expect(structureErrors('**{0}text{/0}** and {1}')).toEqual([])
  })
})

describe('history', () => {
  it('should report a carried translation as stale, with the previous source', async () => {
    const previous = record({ hash: hashSkeleton('Hi {0}world{/0}'), source: 'Hi {0}world{/0}', text: 'Salut {0}le monde{/0}', origin: 'human', review: 'edited', updatedAt: '2026-09-01T00:00:00.000Z' })
    const current = record({ derived: 'update', prev: previous.hash })
    const verified = record({ hash: hashSkeleton('Done'), source: 'Done', text: 'Fini', review: 'verified', verifiedBy: { by: 'atinux', at: '2026-10-03T00:00:00.000Z' } })
    const files = Object.fromEntries([previous, current, verified].map(r => [recordPath('fr', r.hash), serialiseRecord(r)]))
    const resources = Object.keys(files).map(path => ({ id: path, path, locale: 'fr', namespace: undefined, format: 'diglot-record', block: undefined, readonly: false, finder: 'pattern' }) satisfies Resource)
    const history = await recordHistory(() => 'en').load({ host: createMemoryHost(files), resources } as unknown as HistoryContext)
    const fr = history!.changes.get(current.hash)!.get('fr')!
    const en = history!.changes.get(current.hash)!.get('en')!
    expect(fr.updatedAt).toBeLessThan(en.updatedAt)
    expect(history!.valueAt!(current.hash, 'en', fr.updatedAt)).toBe('Hi {0}world{/0}')
    expect(history!.valueAt!(current.hash, 'fr', fr.updatedAt)).toBe('Salut {0}le monde{/0}')
    expect(history!.changes.get(verified.hash)!.get('fr')!.author).toBe('atinux')
    expect(history!.changes.get(verified.hash)!.has('en')).toBe(false)
  })
})

describe('reviews', () => {
  const approve = (value: string): ReviewComment => ({ id: 'a', type: 'approve', author: { name: 'clem' }, time: '2026-10-05T00:00:00.000Z', value })

  it('should verify a record whose current text was approved', () => {
    expect(reviewRecord(record(), [approve(record().text)])).toMatchObject({ review: 'verified', verifiedBy: { by: 'clem', at: '2026-10-05T00:00:00.000Z' } })
  })

  it('should ignore stale approvals and change requests', () => {
    expect(reviewRecord(record(), [approve('something else')])).toEqual(record())
    expect(reviewRecord(record(), [approve(record().text), { id: 'b', type: 'request-change', time: '2026-10-06T00:00:00.000Z' }])).toEqual(record())
  })
})

describe('glossary', () => {
  it('should map diglot decisions onto x18n entries', () => {
    expect(glossaryEntries(new Map([['fr', { terms: [
      { term: 'Nuxt', decision: 'keep' },
      { term: 'server-side rendering', decision: 'translate', target: 'rendu côté serveur' },
      { term: 'Developer Experience', decision: 'keep-gloss', gloss: 'expérience développeur' },
      { term: 'layer', decision: 'translate' },
    ] }]]))).toEqual([
      { term: 'Nuxt', doNotTranslate: true },
      { term: 'server-side rendering', translations: { fr: 'rendu côté serveur' } },
      { term: 'Developer Experience', doNotTranslate: true, note: 'fr: keep, gloss as "expérience développeur"' },
      { term: 'layer' },
    ])
  })
})

describe('x18n project', () => {
  it('should expose a diglot store as keys, messages, usages and diagnostics', async () => {
    const { root, segments, previous } = await store()
    const workspace = await loadWorkspace({ cwd: root, upward: false, cache: false })
    const { project } = workspace.projects[0]!
    await project.ready
    await project.loadHistory()

    const paragraph = segments.get('Nuxt is powered by {0}Nitro{/0}.')!
    expect(project.sourceLocale).toBe('en')
    expect(project.message(paragraph.hash, 'en')?.value).toBe(paragraph.skeleton)
    expect(project.message(paragraph.hash, 'fr')?.value).toBe('Nuxt est propulsé par {0}Nitro{/0}.')

    const [usage] = project.usages({ key: paragraph.hash })
    expect(usage!.usage.path).toBe('sources/docs/guide.md')
    expect(guide.slice(usage!.usage.range.start, usage!.usage.range.end)).toBe('Nuxt is powered by [Nitro](https://nitro.build).')
    const title = segments.get('Getting started')!
    expect(title.format).toBe('plain')
    expect(project.usages({ key: title.hash })).toHaveLength(1)
    const cells = ['Name', 'Description', 'Alpha', 'First letter'].map(s => project.usages({ key: segments.get(s)!.hash })[0]!.usage.range.start)
    expect(new Set(cells).size).toBe(4)

    const codes = project.analyze().diagnostics.map(d => `${d.code} ${d.key}`)
    expect(codes).toContain(`stale-translation ${paragraph.hash}`)
    expect(codes).toContain(`diglot-review ${paragraph.hash}`)
    expect(codes).toContain(`diglot-validate ${segments.get('First letter')!.hash}`)
    expect(codes).toContain(`diglot-unused ${previous.hash}`)
    expect(codes.some(c => c.startsWith('unused-key'))).toBe(false)
    expect(codes.some(c => c.startsWith('missing-translation'))).toBe(false)
    expect(project.valueAt(paragraph.hash, 'en', 0)).toBe('Nuxt runs on {0}Nitro{/0}.')

    const plan = project.plan([{ type: 'set', key: segments.get('Introduction')!.hash, locale: 'fr', value: 'Présentation' }])
    await project.apply(plan)
    const edited = JSON.parse(readFileSync(join(root, recordPath('fr', segments.get('Introduction')!.hash)), 'utf8'))
    expect(edited).toMatchObject({ text: 'Présentation', review: 'edited', origin: 'human' })
    expect(edited.verifiedBy).toBeUndefined()
    project.dispose()
  })
})
