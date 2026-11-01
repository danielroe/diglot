import { writeFileSync } from 'node:fs'
import { isPlaceholderOnly } from '../src/core/skeleton.ts'
import type { Segment } from '../src/core/types.ts'
import { MODULE_REPOS, NUXT_BRANCHES, segmentSource } from '../src/corpus.ts'
import type { Source } from '../src/corpus.ts'

type HashKey = 'hash' | 'sourceHash'

const all = new Map<string, Segment[]>()
for (const source of [...NUXT_BRANCHES, ...MODULE_REPOS]) {
  const files = await segmentSource(source)
  all.set(source.name, files.flatMap(f => f.segments).filter(s => !isPlaceholderOnly(s.skeleton)))
}

function analyse(sources: Source[], key: HashKey) {
  const occurrences = sources.flatMap(s => all.get(s.name)!.map(seg => ({ source: s.name, seg })))
  const byHash = new Map<string, { words: number, sources: Set<string>, count: number }>()
  for (const { source, seg } of occurrences) {
    const entry = byHash.get(seg[key]) ?? { words: seg.words, sources: new Set(), count: 0 }
    entry.sources.add(source)
    entry.count++
    byHash.set(seg[key], entry)
  }
  const totalWords = occurrences.reduce((n, o) => n + o.seg.words, 0)
  const uniqueWords = [...byHash.values()].reduce((n, e) => n + e.words, 0)
  const spread: Record<number, { hashes: number, words: number }> = {}
  for (const e of byHash.values()) {
    const s = spread[e.sources.size] ??= { hashes: 0, words: 0 }
    s.hashes++
    s.words += e.words
  }
  const perSource = Object.fromEntries(sources.map(s => {
    const segs = all.get(s.name)!
    return [s.name, { units: segs.length, unique: new Set(segs.map(x => x[key])).size, words: segs.reduce((n, x) => n + x.words, 0) }]
  }))
  return {
    units: occurrences.length,
    uniqueHashes: byHash.size,
    totalWords,
    uniqueWords,
    wordsSaved: totalWords - uniqueWords,
    wordsSavedPct: +(100 * (totalWords - uniqueWords) / totalWords).toFixed(1),
    hashesBySourceCount: spread,
    perSource,
  }
}

/** Words that would need translating per source if it were added after the others. */
function incremental(order: Source[], key: HashKey) {
  const seen = new Set<string>()
  return order.map((s) => {
    const segs = all.get(s.name)!
    let newWords = 0
    let words = 0
    for (const seg of segs) {
      words += seg.words
      if (!seen.has(seg[key])) newWords += seg.words
    }
    for (const seg of segs) seen.add(seg[key])
    return { source: s.name, words, newWords, newPct: +(100 * newWords / words).toFixed(1) }
  })
}

const branchesOnly = NUXT_BRANCHES
const withModules = [...NUXT_BRANCHES, ...MODULE_REPOS]
const order = [NUXT_BRANCHES[2]!, NUXT_BRANCHES[1]!, NUXT_BRANCHES[0]!, ...MODULE_REPOS]

const pairOverlap = (a: string, b: string, key: HashKey) => {
  const sa = new Set(all.get(a)!.map(s => s[key]))
  const sb = all.get(b)!
  const shared = sb.filter(s => sa.has(s[key]))
  return { units: +(100 * shared.length / sb.length).toFixed(1), words: +(100 * shared.reduce((n, s) => n + s.words, 0) / sb.reduce((n, s) => n + s.words, 0)).toFixed(1) }
}

const result = {
  note: 'Placeholder-only units excluded. `hash` = placeholder form (protected spans ignored), `sourceHash` = full canonical markdown.',
  branches: { hash: analyse(branchesOnly, 'hash'), sourceHash: analyse(branchesOnly, 'sourceHash') },
  withModules: { hash: analyse(withModules, 'hash'), sourceHash: analyse(withModules, 'sourceHash') },
  incrementalFromMain: { hash: incremental(order, 'hash'), sourceHash: incremental(order, 'sourceHash') },
  overlapWithMain: Object.fromEntries(['4.x', '3.x'].map(b => [b, { hash: pairOverlap('main', b, 'hash'), sourceHash: pairOverlap('main', b, 'sourceHash') }])),
  withinMainDuplicates: (() => {
    const segs = all.get('main')!
    const counts = new Map<string, number>()
    for (const s of segs) counts.set(s.hash, (counts.get(s.hash) ?? 0) + 1)
    const top = [...counts].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([h, n]) => ({ n, skeleton: segs.find(s => s.hash === h)!.skeleton.slice(0, 80) }))
    return { units: segs.length, unique: counts.size, top }
  })(),
}

writeFileSync(new URL('../out/dedupe.json', import.meta.url), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
