import { writeFileSync } from 'node:fs'
import { diffSegments } from '../src/core/diff.ts'
import type { Modification } from '../src/core/diff.ts'
import { diffSentences } from '../src/core/sentences.ts'
import { isPlaceholderOnly } from '../src/core/skeleton.ts'
import type { Segment } from '../src/core/types.ts'
import { isDocFile, NUXT_BRANCHES, segmentBlob, segmentSource } from '../src/corpus.ts'
import { git, readBlobs } from '../src/git.ts'

const since = process.argv[2] ?? '6 months ago'
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7]

const translatable = (segs: Segment[]) => segs.filter(s => !isPlaceholderOnly(s.skeleton))

const commits = git(['log', `--since=${since}`, '--reverse', '--first-parent', '--format=%H %P%x09%ct%x09%s', 'HEAD', '--', 'docs'])
  .split('\n').filter(Boolean).map((line) => {
    const [shas, ct, subject] = line.split('\t')
    const [sha, parent] = shas!.split(' ')
    return { sha: sha!, parent: parent!, date: new Date(Number(ct) * 1000), subject: subject! }
  })

interface FileChange { status: string, oldPath: string, newPath: string, oldBlob: string, newBlob: string }

function changedFiles(parent: string, sha: string): FileChange[] {
  return git(['diff-tree', '-r', '-M', '--raw', '--no-commit-id', parent, sha, '--', 'docs'])
    .split('\n').filter(Boolean).map((line) => {
      const [meta, ...paths] = line.split('\t')
      const [, , oldBlob, newBlob, status] = meta!.split(' ')
      return { status: status![0]!, oldPath: paths[0]!, newPath: paths[1] ?? paths[0]!, oldBlob: oldBlob!, newBlob: newBlob! }
    })
    .filter(c => isDocFile(c.newPath) || isDocFile(c.oldPath))
}

async function segmentsOf(path: string, blob: string): Promise<Segment[]> {
  if (/^0+$/.test(blob)) return []
  const source = readBlobs([blob]).get(blob)!
  return translatable((await segmentBlob(path, blob, source)).segments)
}

// Hashes with an existing translation: other branches as they were when the window opened.
const known = new Set<string>()
const windowStart = commits[0]!.date.toISOString()
for (const b of NUXT_BRANCHES.slice(0, 2)) {
  const ref = git(['rev-list', '-1', `--before=${windowStart}`, b.ref]).trim()
  for (const f of await segmentSource({ ...b, ref })) for (const s of f.segments) known.add(s.hash)
}
const corpus = new Map<string, Segment[]>()
for (const f of await segmentSource({ name: 'start', ref: commits[0]!.parent })) corpus.set(f.file, translatable(f.segments))
for (const segs of corpus.values()) for (const s of segs) known.add(s.hash)

const corpusHashes = () => {
  const counts = new Map<string, Segment>()
  for (const segs of corpus.values()) for (const s of segs) counts.set(s.hash, s)
  return counts
}

const perCommit: any[] = []
const allMods: Array<Modification & { sha: string }> = []
const skeletonOnlyChanges: Array<{ sha: string, before: Segment, after: Segment, changed: string[] }> = []
const thresholdStats = Object.fromEntries(THRESHOLDS.map(t => [t, { modified: 0, unambiguous: 0, added: 0, removed: 0 }]))
const totals = { commits: commits.length, docCommits: 0, filesChanged: 0, unchanged: 0, added: 0, removed: 0, modified: 0, unambiguous: 0, sourceModified: 0, sourceUnchanged: 0 }

for (const commit of commits) {
  const before = corpusHashes()
  const changes = changedFiles(commit.parent, commit.sha)
  const row = { sha: commit.sha.slice(0, 10), date: commit.date.toISOString().slice(0, 10), subject: commit.subject.slice(0, 80), files: changes.length, unchanged: 0, added: 0, removed: 0, modified: 0, unambiguous: 0, cosmetic: 0, sourceOnly: 0, disappeared: 0, disappearedWords: 0, newHashes: 0, needsTranslation: 0, needsTranslationWords: 0, seeded: 0 }
  const seededHashes = new Set<string>()

  for (const change of changes) {
    const oldSegs = change.status === 'A' ? [] : await segmentsOf(change.oldPath, change.oldBlob)
    const newSegs = change.status === 'D' ? [] : await segmentsOf(change.newPath, change.newBlob)
    if (change.status === 'D' || change.status === 'R') corpus.delete(change.oldPath)
    if (change.status !== 'D') corpus.set(change.newPath, newSegs)

    const d = diffSegments(oldSegs, newSegs)
    row.unchanged += d.unchanged.length
    row.added += d.added.length
    row.removed += d.removed.length
    row.modified += d.modified.length
    row.unambiguous += d.modified.filter(m => !m.ambiguous).length
    row.cosmetic += d.modified.filter(m => classify(m) !== 'content').length
    for (const m of d.modified) {
      allMods.push({ ...m, sha: commit.sha })
      seededHashes.add(m.after.hash)
    }

    const ds = diffSegments(oldSegs, newSegs, { key: 'sourceHash' })
    totals.sourceModified += ds.modified.length + ds.added.length
    totals.sourceUnchanged += ds.unchanged.length
    for (const m of ds.modified) {
      if (m.before.hash !== m.after.hash) continue
      row.sourceOnly++
      const changed = m.after.placeholders
        .filter((p, i) => p.source !== m.before.placeholders[i]?.source || p.close !== m.before.placeholders[i]?.close)
        .map(p => p.type === 'link' && p.close !== undefined ? 'link-url' : p.type === 'link' ? 'link-atomic' : p.type)
      skeletonOnlyChanges.push({ sha: commit.sha, before: m.before, after: m.after, changed: [...new Set(changed)] })
    }

    for (const t of THRESHOLDS) {
      const dt = diffSegments(oldSegs, newSegs, { threshold: t })
      thresholdStats[t]!.modified += dt.modified.length
      thresholdStats[t]!.unambiguous += dt.modified.filter(m => !m.ambiguous).length
      thresholdStats[t]!.added += dt.added.length
      thresholdStats[t]!.removed += dt.removed.length
    }
  }

  const after = corpusHashes()
  for (const [h, s] of before) {
    if (!after.has(h)) {
      row.disappeared++
      row.disappearedWords += s.words
    }
  }
  for (const [h, s] of after) {
    if (before.has(h)) continue
    row.newHashes++
    if (!known.has(h)) {
      row.needsTranslation++
      row.needsTranslationWords += s.words
      if (seededHashes.has(h)) row.seeded++
    }
    known.add(h)
  }
  if (changes.length) totals.docCommits++
  totals.filesChanged += changes.length
  totals.unchanged += row.unchanged
  totals.added += row.added
  totals.removed += row.removed
  totals.modified += row.modified
  totals.unambiguous += row.unambiguous
  perCommit.push(row)
}

function lettersOf(text: string) {
  return text.replace(/\]\([^)]*\)/g, '').replace(/[`*_[\]~\\]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function classify(m: Modification): 'whitespace-punctuation' | 'case' | 'markup' | 'content' {
  const a = m.before.skeleton, b = m.after.skeleton
  if (a.replace(/[^\p{L}\p{N}{}/]/gu, '') === b.replace(/[^\p{L}\p{N}{}/]/gu, '')) return 'whitespace-punctuation'
  if (a.toLowerCase() === b.toLowerCase()) return 'case'
  if (lettersOf(m.before.text) === lettersOf(m.after.text)) return 'markup'
  return 'content'
}

const weeks = new Map<string, { commits: number, disappeared: number, needsTranslation: number, needsTranslationWords: number, seeded: number, modified: number }>()
for (const row of perCommit) {
  const d = new Date(row.date)
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
  const w = weeks.get(monday) ?? { commits: 0, disappeared: 0, needsTranslation: 0, needsTranslationWords: 0, seeded: 0, modified: 0 }
  w.commits++
  w.disappeared += row.disappeared
  w.needsTranslation += row.needsTranslation
  w.needsTranslationWords += row.needsTranslationWords
  w.seeded += row.seeded
  w.modified += row.modified
  weeks.set(monday, w)
}
const weekRows = [...weeks].sort().map(([week, w]) => ({ week, ...w }))
const spanWeeks = (perCommit.length ? (Date.parse(perCommit.at(-1).date) - Date.parse(perCommit[0].date)) / (7 * 86400000) : 0) || 1
const sum = (k: string) => perCommit.reduce((n, r) => n + r[k], 0)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)]! : 0
}

const classes = countBy(allMods, classify)
const content = allMods.filter(m => classify(m) === 'content')
const sentence = { modifiedContent: content.length, multiSentence: 0, exactlyOneChanged: 0, exactlyOneChangedMulti: 0, changedCounts: {} as Record<string, number>, suspiciousSplits: 0, examples: [] as any[] }
for (const m of content) {
  const sd = diffSentences(m.before.skeleton, m.after.skeleton)
  const n = Math.max(sd.changed.length, sd.dropped.length)
  sentence.changedCounts[n >= 4 ? '4+' : String(n)] = (sentence.changedCounts[n >= 4 ? '4+' : String(n)] ?? 0) + 1
  const multi = sd.after.length >= 2 || sd.before.length >= 2
  if (multi) sentence.multiSentence++
  if (sd.changed.length <= 1 && sd.dropped.length <= 1 && n === 1) {
    sentence.exactlyOneChanged++
    if (multi) {
      sentence.exactlyOneChangedMulti++
      if (sentence.examples.length < 6) sentence.examples.push({ before: sd.dropped.map(i => sd.before[i]), after: sd.changed.map(i => sd.after[i]), of: sd.after.length })
    }
  }
  if (sd.after.some(s => /\b(?:e\.g|i\.e|etc|vs)\.$/i.test(s))) sentence.suspiciousSplits++
}

const simHistogram = countBy(allMods, m => m.similarity >= 0.9 ? '0.9-1' : m.similarity >= 0.8 ? '0.8-0.9' : m.similarity >= 0.7 ? '0.7-0.8' : m.similarity >= 0.6 ? '0.6-0.7' : '0.5-0.6')
const result = {
  since,
  range: { from: perCommit[0]?.date, to: perCommit.at(-1)?.date, weeks: +spanWeeks.toFixed(1) },
  totals,
  corpus: {
    disappeared: sum('disappeared'),
    disappearedWords: sum('disappearedWords'),
    needsTranslation: sum('needsTranslation'),
    needsTranslationWords: sum('needsTranslationWords'),
    seededFromModified: sum('seeded'),
    perWeek: {
      disappeared: +(sum('disappeared') / spanWeeks).toFixed(1),
      needsTranslation: +(sum('needsTranslation') / spanWeeks).toFixed(1),
      needsTranslationWords: +(sum('needsTranslationWords') / spanWeeks).toFixed(0),
      medianWeekNeedsTranslation: median(weekRows.map(w => w.needsTranslation)),
    },
  },
  thresholds: thresholdStats,
  similarityHistogram: simHistogram,
  modificationClasses: classes,
  cosmeticExamples: allMods.filter(m => classify(m) !== 'content').slice(0, 10).map(m => ({ cls: classify(m), before: m.before.skeleton.slice(0, 120), after: m.after.skeleton.slice(0, 120) })),
  ambiguousExamples: allMods.filter(m => m.ambiguous).slice(0, 6).map(m => ({ sim: +m.similarity.toFixed(2), before: m.before.skeleton.slice(0, 100), after: m.after.skeleton.slice(0, 100) })),
  lowSimilarityExamples: allMods.filter(m => m.similarity < 0.6).slice(0, 8).map(m => ({ sim: +m.similarity.toFixed(2), before: m.before.skeleton.slice(0, 100), after: m.after.skeleton.slice(0, 100) })),
  skeletonHashAbsorbed: {
    count: skeletonOnlyChanges.length,
    byChangedType: countBy(skeletonOnlyChanges, c => c.changed.join('+') || 'none'),
    examples: skeletonOnlyChanges.map(c => ({ sha: c.sha.slice(0, 10), changed: c.changed, before: c.before.text.slice(0, 160), after: c.after.text.slice(0, 160) })),
  },
  sentence,
  weeks: weekRows,
  topCommits: [...perCommit].sort((a, b) => b.needsTranslation - a.needsTranslation).slice(0, 12),
  perCommit,
}

writeFileSync(new URL('../out/changes.json', import.meta.url), JSON.stringify(result, null, 2))
const { perCommit: _, skeletonHashAbsorbed, ...summary } = result
console.log(JSON.stringify({ ...summary, skeletonHashAbsorbed: { ...skeletonHashAbsorbed, examples: skeletonHashAbsorbed.examples.slice(0, 5) } }, null, 2))

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

