import type { DiffableSegment, Segment, TranslationRecord } from '@diglot/core'
import type { MtOptions, QaIssue, Usage } from '@diglot/mt'
import type { ManifestEntry, ResolvedConfig } from '@diglot/store'
import type { CloneUrl } from './sources.ts'
import { extractSource } from '@diglot/cli'
import { createRecord, diffSegments, isPlaceholderOnly } from '@diglot/core'
import { addUsage, emptyUsage, translateSegments, updateTranslation } from '@diglot/mt'
import { build, createManifest, liveHashes, loadConfig, loadGlossary, loadLocale, loadLocaleState, loadStyle, mtEnabled, readManifest, readManifests, validationTarget, writeManifest, writeRecord } from '@diglot/store'
import { relative } from 'pathe'
import { commitChanges } from './git.ts'
import { ensureCheckouts } from './sources.ts'
import { extendLineage, readLineage, readRejections, writeLineage, writeRejections } from './state.ts'

export interface RunOptions {
  /** Root of the translations repository. Defaults to `.`. */
  cwd?: string
  /** Only these locales. Defaults to every configured locale. */
  locales?: string[]
  /** Only these sources. Defaults to every configured source. */
  sources?: string[]
  /** Overrides `mt.model` from the config. */
  model?: MtOptions['model']
  /** Most segments per locale sent to the model in one run. Defaults to no limit. */
  limit?: number
  /** Translate segments that were rejected in earlier runs again. */
  retryRejected?: boolean
  /** Commit the changes. Defaults to `true`. */
  commit?: boolean
  /** Build `dist/<locale>.json` and add it to the commit. Defaults to `true`. */
  buildDist?: boolean
  /** Commit identity. */
  author?: { name: string, email: string }
  cloneUrl?: CloneUrl
  now?: () => Date
  log?: (message: string) => void
}

export interface Rejection {
  hash: string
  file?: string
  issues: QaIssue[]
}

export interface LocaleReport {
  locale: string
  enabled: boolean
  translated: number
  updated: number
  carried: number
  rejected: number
  /** Live segments left alone because a reviewer rejected their record. */
  skipped: number
  /** Untranslated segments left for a later run by `limit`. */
  deferred: number
  usage: Usage
  rejections: Rejection[]
}

export interface SourceReport {
  name: string
  sha?: string
  previous?: string
  segments: number
  added: number
  removed: number
  modified: number
}

export interface RunResult {
  sources: SourceReport[]
  locales: LocaleReport[]
  totals: { translated: number, updated: number, carried: number, rejected: number, costUsd?: number }
  /** Whether any tracked file changed. */
  changed: boolean
  /** The commit message, when there were changes. */
  message?: string
  /** The new commit, when one was made. */
  sha?: string
}

interface Live {
  segment: Segment
  file: string
}

/**
 * Brings the translations repository in line with its sources: extracts every source,
 * diffs it against the stored manifest, and for each locale with machine translation
 * enabled carries, updates or translates the segments that have no record yet. Writes
 * records, manifests and `dist/<locale>.json`, then commits everything as one commit.
 */
export async function run(options: RunOptions = {}): Promise<RunResult> {
  const log = options.log ?? (() => {})
  const now = (options.now ?? (() => new Date()))().toISOString()
  const config = await loadConfig(options.cwd ?? '.')
  const selected = options.sources?.length ? config.sources.filter(s => options.sources!.includes(s.name)) : config.sources
  if (options.sources?.length && selected.length !== options.sources.length)
    throw new Error(`unknown source in ${options.sources.join(', ')}; configured: ${config.sources.map(s => s.name).join(', ')}`)

  const live = new Map<string, Live>()
  const titles = new Map<string, string>()
  const previousEntries = new Map<string, ManifestEntry>()
  const pairs: Array<{ before: string, after: string }> = []
  const sources: SourceReport[] = []
  for (const source of await ensureCheckouts(config, selected, options.cloneUrl)) {
    const { snapshot, files } = await extractSource(config, source)
    const previous = await readManifest(config.stateDir, source.name)
    const report: SourceReport = { name: source.name, ...(snapshot.sha ? { sha: snapshot.sha } : {}), ...(previous?.sha ? { previous: previous.sha } : {}), segments: 0, added: 0, removed: 0, modified: 0 }
    for (const entries of Object.values(previous?.files ?? {})) {
      for (const entry of entries)
        previousEntries.set(entry.hash, entry)
    }
    for (const file of new Set([...Object.keys(previous?.files ?? {}), ...Object.keys(files)])) {
      const diff = diffSegments<DiffableSegment>(previous?.files[file] ?? [], files[file] ?? [], config.diff)
      report.added += diff.added.length
      report.removed += diff.removed.length
      report.modified += diff.modified.length
      pairs.push(...diff.modified.map(m => ({ before: m.before.hash, after: m.after.hash })))
    }
    for (const [file, segments] of Object.entries(files)) {
      report.segments += segments.length
      for (const segment of segments) {
        if (!live.has(segment.hash))
          live.set(segment.hash, { segment, file })
        if (segment.kind === 'frontmatter' && segment.context.detail === 'title' && !titles.has(file))
          titles.set(file, segment.skeleton)
      }
    }
    await writeManifest(config.stateDir, createManifest(source.name, files, { ref: source.ref, sha: snapshot.sha }))
    sources.push(report)
    log(`${source.name}: ${report.segments} segments, +${report.added} -${report.removed} ~${report.modified}`)
  }

  const allLive = liveHashes(await readManifests(config.stateDir))
  const lineage = extendLineage(await readLineage(config.stateDir), pairs, allLive)
  await writeLineage(config.stateDir, lineage)

  const locales: LocaleReport[] = []
  for (const locale of options.locales?.length ? config.locales.filter(l => options.locales!.includes(l)) : config.locales) {
    const report: LocaleReport = { locale, enabled: mtEnabled(await loadLocaleState(config.root, locale)), translated: 0, updated: 0, carried: 0, rejected: 0, skipped: 0, deferred: 0, usage: emptyUsage(), rejections: [] }
    locales.push(report)
    if (!report.enabled) {
      log(`${locale}: machine translation disabled`)
      continue
    }
    await translateLocale(config, locale, { live, titles, lineage, previousEntries, allLive, now, report, options })
    log(`${locale}: translated ${report.translated}, updated ${report.updated}, carried ${report.carried}, rejected ${report.rejected}${report.skipped ? `, skipped ${report.skipped}` : ''}${report.deferred ? `, deferred ${report.deferred}` : ''}`)
  }

  if (options.buildDist !== false)
    await build(config.root, { locales: config.locales, outDir: relative(config.root, config.outDir), only: allLive })

  const totals = {
    translated: sum(locales, 'translated'),
    updated: sum(locales, 'updated'),
    carried: sum(locales, 'carried'),
    rejected: sum(locales, 'rejected'),
    ...costOf(locales),
  }
  const message = commitMessage(locales, sources)
  const stateDir = relative(config.root, config.stateDir)
  const committed = await commitChanges(config.root, [...config.locales, stateDir], message, {
    exclude: [`${stateDir}/checkouts`],
    force: options.buildDist === false ? [] : [relative(config.root, config.outDir)],
    ...(options.commit === false ? {} : { author: options.author ?? { name: 'diglot[bot]', email: 'diglot[bot]@users.noreply.github.com' } }),
  })
  return { sources, locales, totals, changed: committed.changed, ...(committed.changed ? { message } : {}), ...(committed.sha ? { sha: committed.sha } : {}) }
}

interface LocaleContext {
  live: Map<string, Live>
  titles: Map<string, string>
  lineage: Record<string, string[]>
  previousEntries: Map<string, ManifestEntry>
  allLive: Set<string>
  now: string
  report: LocaleReport
  options: RunOptions
}

async function translateLocale(config: ResolvedConfig, locale: string, context: LocaleContext): Promise<void> {
  const { live, report, now } = context
  const records = await loadLocale(config.root, locale)
  const rejections = Object.fromEntries(Object.entries(await readRejections(config.stateDir, locale)).filter(([hash]) => context.allLive.has(hash)))
  const mt: MtOptions = {
    locale,
    ...(context.options.model ?? config.mt.model ? { model: context.options.model ?? config.mt.model } : {}),
    ...(config.mt.subject ? { subject: config.mt.subject } : {}),
    ...(config.mt.qaRetries === undefined ? {} : { qaRetries: config.mt.qaRetries }),
  }
  const glossary = await loadGlossary(config.root, locale, config.glossary ? { shared: config.glossary } : {})
  const style = await loadStyle(config.root, locale)
  if (glossary)
    mt.glossary = glossary
  if (style)
    mt.style = style

  const updates: Array<{ item: Live, previous: TranslationRecord }> = []
  const fresh: Live[] = []
  for (const [hash, item] of live) {
    if (records.get(hash)?.review === 'rejected')
      report.skipped++
    if (records.has(hash) || isPlaceholderOnly(item.segment.skeleton) || (rejections[hash] && !context.options.retryRejected))
      continue
    const ancestor = context.lineage[hash]?.find(h => records.has(h))
    if (ancestor && records.get(ancestor)!.review !== 'rejected')
      updates.push({ item, previous: records.get(ancestor)! })
    else
      fresh.push(item)
  }
  const limit = context.options.limit ?? Infinity
  const updateBatch = updates.slice(0, limit)
  const freshBatch = fresh.slice(0, Math.max(0, limit - updateBatch.length))
  report.deferred = updates.length - updateBatch.length + fresh.length - freshBatch.length

  const write = async (record: TranslationRecord) => {
    await writeRecord(config.root, locale, record)
    records.set(record.hash, record)
    delete rejections[record.hash]
  }
  const reject = (item: Live, issues: QaIssue[]) => {
    report.rejected++
    report.rejections.push({ hash: item.segment.hash, file: item.file, issues })
    rejections[item.segment.hash] = issues.filter(i => i.severity === 'error').map(i => `${i.check}: ${i.message}`)
  }

  await pool(updateBatch, 4, async ({ item, previous }) => {
    const entry = context.previousEntries.get(previous.hash)
    const previousSource = entry ? { skeleton: previous.source, placeholders: validationTarget(entry).placeholders } : previous.source
    const result = await updateTranslation(previous, { previousSource, nextSource: item.segment }, mt)
    addUsage(report.usage, result.usage)
    if (result.status === 'rejected')
      return reject(item, result.issues)
    report[result.derived === 'carry' ? 'carried' : 'updated']++
    const mtField = result.derived === 'carry' ? previous.mt : result.mt
    await write(createRecord({ segment: item.segment, text: result.text, origin: result.derived === 'carry' ? previous.origin : 'mt', derived: result.derived, prev: previous.hash, ...(mtField ? { mt: mtField } : {}), updatedAt: now }))
  })

  if (freshBatch.length) {
    const byHash = new Map(freshBatch.map(item => [item.segment.hash, item]))
    const result = await translateSegments(freshBatch.map(item => item.segment), {
      ...mt,
      batch: config.mt.batch ?? 'page',
      context: file => file ? { path: file, ...(context.titles.has(file) ? { title: context.titles.get(file)! } : {}) } : undefined,
    })
    addUsage(report.usage, result.usage)
    for (const t of result.translations) {
      report.translated++
      await write(createRecord({ segment: byHash.get(t.hash)!.segment, text: t.text, origin: 'mt', derived: 'fresh', mt: t.mt, updatedAt: now }))
    }
    for (const r of result.rejected)
      reject(byHash.get(r.hash)!, r.issues)
  }
  await writeRejections(config.stateDir, locale, rejections)
}

function sum(locales: LocaleReport[], key: 'translated' | 'updated' | 'carried' | 'rejected'): number {
  return locales.reduce((n, l) => n + l[key], 0)
}

function costOf(locales: LocaleReport[]): { costUsd?: number } {
  const costs = locales.flatMap(l => l.usage.costUsd === undefined ? [] : [l.usage.costUsd])
  return costs.length ? { costUsd: Math.round(costs.reduce((a, b) => a + b, 0) * 1e6) / 1e6 } : {}
}

/** The commit message of a run, for example `chore(fr): translate 78 segments, update 12, carry 31`. */
export function commitMessage(locales: LocaleReport[], sources: SourceReport[]): string {
  const active = locales.filter(l => l.translated + l.updated + l.carried > 0)
  const revisions = sources.map(s => `${s.name}${s.sha ? `@${s.sha.slice(0, 10)}` : ''}`).join(', ')
  if (!active.length)
    return `chore: sync ${revisions || 'sources'}`
  const subject = `chore(${active.map(l => l.locale).join(', ')}): translate ${sum(active, 'translated')} segments, update ${sum(active, 'updated')}, carry ${sum(active, 'carried')}`
  const body = [
    ...(active.length > 1 ? active.map(l => `${l.locale}: translate ${l.translated}, update ${l.updated}, carry ${l.carried}`) : []),
    ...(sum(locales, 'rejected') ? [`rejected: ${locales.filter(l => l.rejected).map(l => `${l.locale} ${l.rejected}`).join(', ')}`] : []),
    `sources: ${revisions}`,
  ]
  return `${subject}\n\n${body.join('\n')}`
}

async function pool<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length)
      await task(items[next++]!)
  }))
}
