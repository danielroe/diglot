import type { DiffableSegment, SegmentDiff, SegmentStatus } from '@diglot/core'
import type { ManifestEntry } from '@diglot/store'
import type { SubCommandsDef } from 'citty'
import process from 'node:process'
import { diffSegments, hashSkeleton, isPlaceholderOnly, recordStatus, sentenceDiff, validate } from '@diglot/core'
import { build, createManifest, liveHashes, loadConfig, loadLocale, readManifest, readManifests, readRecords, validationTarget, writeManifest } from '@diglot/store'
import { defineCommand } from 'citty'
import { relative } from 'pathe'
import { extractSource, selectSources } from './extract.ts'

const common = {
  cwd: { type: 'string', description: 'Translations repository root', default: '.' },
} as const

function print(...lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`)
}

function json(value: unknown): void {
  print(JSON.stringify(value, null, 2))
}

const extract = defineCommand({
  meta: { name: 'extract', description: 'Extract source segments and write a manifest per source' },
  args: {
    ...common,
    source: { type: 'string', description: 'Only this source' },
  },
  async run({ args }) {
    const config = await loadConfig(args.cwd)
    for (const source of selectSources(config, args.source)) {
      const { snapshot, files } = await extractSource(config, source)
      const manifest = createManifest(source.name, files, { ref: source.ref, sha: snapshot.sha })
      const path = await writeManifest(config.stateDir, manifest)
      const segments = Object.values(files).flat()
      print(`${source.name}: ${snapshot.files.length} files, ${segments.length} segments, ${new Set(segments.map(s => s.hash)).size} unique hashes -> ${relative(config.root, path)}`)
    }
  },
})

interface FileDiff {
  file: string
  status: 'added' | 'removed' | 'changed'
  diff: SegmentDiff<DiffableSegment>
}

const diff = defineCommand({
  meta: { name: 'diff', description: 'Compare the sources with their manifests: added, removed and modified segments per file' },
  args: {
    ...common,
    source: { type: 'string', description: 'Only this source' },
    json: { type: 'boolean', description: 'Print JSON' },
  },
  async run({ args }) {
    const config = await loadConfig(args.cwd)
    const report: Record<string, { sha?: string, previous?: string, files: FileDiff[] }> = {}
    for (const source of selectSources(config, args.source)) {
      const previous = await readManifest(config.stateDir, source.name)
      const { snapshot, files } = await extractSource(config, source)
      const before: Record<string, ManifestEntry[]> = previous?.files ?? {}
      const paths = [...new Set([...Object.keys(before), ...Object.keys(files)])].sort()
      const changes: FileDiff[] = []
      for (const file of paths) {
        const result = diffSegments<DiffableSegment>(before[file] ?? [], files[file] ?? [], config.diff)
        if (!result.added.length && !result.removed.length && !result.modified.length)
          continue
        changes.push({ file, status: !before[file] ? 'added' : !files[file] ? 'removed' : 'changed', diff: result })
      }
      report[source.name] = { ...(snapshot.sha ? { sha: snapshot.sha } : {}), ...(previous?.sha ? { previous: previous.sha } : {}), files: changes }
    }
    if (args.json)
      return json(report)
    for (const [name, { files }] of Object.entries(report)) {
      const total = (key: 'added' | 'removed' | 'modified') => files.reduce((n, f) => n + f.diff[key].length, 0)
      print(`${name}: ${files.length} files changed, ${total('added')} added, ${total('removed')} removed, ${total('modified')} modified`)
      for (const { file, status, diff } of files) {
        print(`  ${status === 'added' ? '+' : status === 'removed' ? '-' : '~'} ${file} (+${diff.added.length} -${diff.removed.length} ~${diff.modified.length})`)
        for (const m of diff.modified) {
          const sentences = sentenceDiff(m.before.skeleton, m.after.skeleton)
          print(`      ~ ${m.after.skeleton.slice(0, 100)} (${m.similarity.toFixed(2)}${m.ambiguous ? ', ambiguous' : ''}, ${sentences.changed.length}/${sentences.after.length} sentences changed)`)
        }
        for (const a of diff.added)
          print(`      + ${a.skeleton.slice(0, 100)}`)
        for (const r of diff.removed)
          print(`      - ${r.skeleton.slice(0, 100)}`)
      }
    }
  },
})

interface Issue {
  locale: string
  hash?: string
  message: string
}

const validateCommand = defineCommand({
  meta: { name: 'validate', description: 'Validate every record against its source segments' },
  args: {
    ...common,
    locale: { type: 'string', description: 'Only this locale' },
    json: { type: 'boolean', description: 'Print JSON' },
  },
  async run({ args }) {
    const config = await loadConfig(args.cwd)
    const manifests = await readManifests(config.stateDir)
    const targets = new Map<string, ManifestEntry[]>()
    for (const entry of manifests.flatMap(m => Object.values(m.files).flat())) {
      const list = targets.get(entry.hash) ?? []
      if (!list.some(e => e.kind === entry.kind && e.format === entry.format))
        targets.set(entry.hash, [...list, entry])
    }
    const errors: Issue[] = []
    const warnings: Issue[] = []
    let checked = 0
    for (const locale of args.locale ? [args.locale] : config.locales) {
      const records = await readRecords(config.root, locale).catch((error: Error) => {
        errors.push({ locale, message: error.message })
        return []
      })
      for (const record of records) {
        checked++
        const entries = targets.get(record.hash)
        const formats = entries ? new Set(entries.map(e => e.format)) : new Set(['markdown', 'plain'] as const)
        if (![...formats].some(format => hashSkeleton(record.source, record.salt, format) === record.hash))
          errors.push({ locale, hash: record.hash, message: 'hash does not match the source skeleton' })
        if (!entries) {
          warnings.push({ locale, hash: record.hash, message: 'not used by any source' })
          continue
        }
        for (const entry of entries) {
          const result = validate(record.text, validationTarget(entry))
          errors.push(...result.errors.map(e => ({ locale, hash: record.hash, message: `${entry.kind}: ${e.message}` })))
          warnings.push(...result.warnings.map(e => ({ locale, hash: record.hash, message: `${entry.kind}: ${e.message}` })))
        }
      }
    }
    if (errors.length)
      process.exitCode = 1
    if (args.json)
      return json({ checked, errors, warnings })
    for (const issue of errors)
      print(`error ${issue.locale}${issue.hash ? ` ${issue.hash}` : ''}: ${issue.message}`)
    for (const issue of warnings)
      print(`warning ${issue.locale}${issue.hash ? ` ${issue.hash}` : ''}: ${issue.message}`)
    print(`${checked} records checked, ${errors.length} errors, ${warnings.length} warnings`)
  },
})

const buildCommand = defineCommand({
  meta: { name: 'build', description: 'Build dist/<locale>.json from the records used by any source' },
  args: {
    ...common,
    locale: { type: 'string', description: 'Only this locale' },
    all: { type: 'boolean', description: 'Include records not used by any source' },
  },
  async run({ args }) {
    const config = await loadConfig(args.cwd)
    const manifests = await readManifests(config.stateDir)
    const results = await build(config.root, {
      locales: args.locale ? [args.locale] : config.locales,
      outDir: relative(config.root, config.outDir),
      ...(args.all || !manifests.length ? {} : { only: liveHashes(manifests) }),
    })
    for (const r of results)
      print(`${r.locale}: ${r.records} records -> ${r.path}${r.skipped ? ` (${r.skipped} unused skipped)` : ''}`)
  },
})

const STATUSES: SegmentStatus[] = ['verified', 'edited', 'pending-review', 'machine', 'rejected', 'untranslated']

const status = defineCommand({
  meta: { name: 'status', description: 'Translation status per locale and source' },
  args: {
    ...common,
    locale: { type: 'string', description: 'Only this locale' },
    json: { type: 'boolean', description: 'Print JSON' },
  },
  async run({ args }) {
    const config = await loadConfig(args.cwd)
    const manifests = await readManifests(config.stateDir)
    const report: Record<string, Record<string, { segments: number, words: number, reviewedWords: number, byStatus: Record<string, { segments: number, words: number }> }>> = {}
    for (const locale of args.locale ? [args.locale] : config.locales) {
      const records = await loadLocale(config.root, locale)
      report[locale] = {}
      for (const manifest of manifests) {
        const row = report[locale][manifest.source] = { segments: 0, words: 0, reviewedWords: 0, byStatus: {} as Record<string, { segments: number, words: number }> }
        for (const entry of Object.values(manifest.files).flat()) {
          if (isPlaceholderOnly(entry.skeleton))
            continue
          const state = recordStatus(records.get(entry.hash), validationTarget(entry))
          const bucket = row.byStatus[state] ??= { segments: 0, words: 0 }
          bucket.segments++
          bucket.words += entry.words
          row.segments++
          row.words += entry.words
          if (state === 'edited' || state === 'verified')
            row.reviewedWords += entry.words
        }
      }
    }
    if (args.json)
      return json(report)
    for (const [locale, sources] of Object.entries(report)) {
      print(locale)
      for (const [name, row] of Object.entries(sources)) {
        const pct = row.words ? (100 * row.reviewedWords / row.words).toFixed(1) : '0.0'
        const parts = STATUSES.filter(s => row.byStatus[s]).map(s => `${s} ${row.byStatus[s]!.segments}`)
        print(`  ${name}: ${row.segments} segments, ${row.words} words, ${pct}% of words reviewed (${parts.join(', ')})`)
      }
    }
  },
})

export const subCommands: SubCommandsDef = { extract, diff, validate: validateCommand, build: buildCommand, status }
