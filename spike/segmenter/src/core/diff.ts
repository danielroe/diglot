import { distance } from 'fastest-levenshtein'
import type { Segment } from './types.ts'

export interface Modification {
  before: Segment
  after: Segment
  /** Normalised Levenshtein similarity of the two skeletons, 0..1. */
  similarity: number
  /** Another candidate scored within `AMBIGUITY_MARGIN` of this match. */
  ambiguous: boolean
}

export interface SegmentDiff {
  unchanged: Segment[]
  added: Segment[]
  removed: Segment[]
  modified: Modification[]
}

export interface DiffOptions {
  key?: 'hash' | 'sourceHash'
  /** Minimum similarity for a removed/added pair to count as one evolved segment. */
  threshold?: number
}

export const DEFAULT_THRESHOLD = 0.5
export const AMBIGUITY_MARGIN = 0.1
/** Penalty per unit of relative position shift (0 = same relative place in the file, 1 = opposite end). */
const POSITION_WEIGHT = 0.2

export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  return max ? 1 - distance(a, b) / max : 1
}

/**
 * Diffs two segment lists of one file. Exact hash matches are unchanged; the leftovers
 * are paired greedily by skeleton similarity minus a relative-position penalty.
 */
export function diffSegments(before: Segment[], after: Segment[], options: DiffOptions = {}): SegmentDiff {
  const key = options.key ?? 'hash'
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const pool = new Map<string, Segment[]>()
  for (const s of before) pool.set(s[key], [...(pool.get(s[key]) ?? []), s])

  const unchanged: Segment[] = []
  const added: Segment[] = []
  for (const s of after) {
    const match = pool.get(s[key])?.shift()
    if (match) unchanged.push(s)
    else added.push(s)
  }
  const removed = [...pool.values()].flat()

  const relBefore = (s: Segment) => s.context.index / Math.max(1, before.length - 1)
  const relAfter = (s: Segment) => s.context.index / Math.max(1, after.length - 1)
  const candidates: Array<{ r: Segment, a: Segment, sim: number, score: number }> = []
  for (const r of removed) {
    for (const a of added) {
      if (r.format !== a.format) continue
      const sim = similarity(r.skeleton, a.skeleton)
      if (sim < threshold) continue
      const kindPenalty = r.kind === a.kind ? 0 : 0.1
      candidates.push({ r, a, sim, score: sim - kindPenalty - POSITION_WEIGHT * Math.abs(relBefore(r) - relAfter(a)) })
    }
  }
  candidates.sort((x, y) => y.score - x.score)
  const byR = Map.groupBy(candidates, c => c.r)
  const byA = Map.groupBy(candidates, c => c.a)

  const usedR = new Set<Segment>()
  const usedA = new Set<Segment>()
  const modified: Modification[] = []
  for (const c of candidates) {
    if (usedR.has(c.r) || usedA.has(c.a)) continue
    usedR.add(c.r)
    usedA.add(c.a)
    // A rival with the same hash as the chosen side carries the same translation, so it is not ambiguous.
    const rivals = [
      ...byR.get(c.r)!.filter(o => o.a.hash !== c.a.hash),
      ...byA.get(c.a)!.filter(o => o.r.hash !== c.r.hash),
    ].filter(o => o.score >= c.score - AMBIGUITY_MARGIN)
    modified.push({ before: c.r, after: c.a, similarity: c.sim, ambiguous: rivals.length > 0 })
  }
  return {
    unchanged,
    added: added.filter(s => !usedA.has(s)),
    removed: removed.filter(s => !usedR.has(s)),
    modified,
  }
}
