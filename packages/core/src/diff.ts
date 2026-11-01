import type { Segment } from './types.ts'
import { distance } from 'fastest-levenshtein'

/** The fields `diffSegments` compares. Position in the file is the index in the list. */
export type DiffableSegment = Pick<Segment, 'hash' | 'kind' | 'format' | 'skeleton'>

export interface Modification<T extends DiffableSegment = DiffableSegment> {
  /** The predecessor. */
  before: T
  after: T
  /** Normalised Levenshtein similarity of the two skeletons, 0 to 1. */
  similarity: number
  /** Another pairing with a different hash scored within `margin` of this one. */
  ambiguous: boolean
}

export interface SegmentDiff<T extends DiffableSegment = DiffableSegment> {
  unchanged: T[]
  added: T[]
  removed: T[]
  modified: Array<Modification<T>>
}

export interface DiffOptions {
  /** Minimum similarity for a removed and an added segment to count as one modified segment. Defaults to `0.5`. */
  threshold?: number
  /** Score margin within which a rival pairing makes a match ambiguous. Defaults to `0.1`. */
  margin?: number
}

const KIND_PENALTY = 0.1
const POSITION_WEIGHT = 0.2

/** Normalised Levenshtein similarity, 0 to 1. */
export function similarity(a: string, b: string): number {
  if (a === b)
    return 1
  const max = Math.max(a.length, b.length)
  return max ? 1 - distance(a, b) / max : 1
}

/**
 * Diffs the segments of one file before and after a change. Equal hashes (as a multiset)
 * are unchanged. Remaining removed and added segments are paired greedily, best first, by
 * skeleton similarity minus penalties for a different kind and for a shift in relative
 * position; pairs below `threshold` stay added and removed.
 */
export function diffSegments<T extends DiffableSegment>(before: readonly T[], after: readonly T[], options: DiffOptions = {}): SegmentDiff<T> {
  const threshold = options.threshold ?? 0.5
  const margin = options.margin ?? 0.1
  const position = new Map<T, number>()
  before.forEach((s, i) => position.set(s, i / Math.max(1, before.length - 1)))
  after.forEach((s, i) => position.set(s, i / Math.max(1, after.length - 1)))

  const pool = new Map<string, T[]>()
  for (const segment of before)
    pool.set(segment.hash, [...(pool.get(segment.hash) ?? []), segment])
  const unchanged: T[] = []
  const added: T[] = []
  for (const segment of after) {
    if (pool.get(segment.hash)?.shift())
      unchanged.push(segment)
    else
      added.push(segment)
  }
  const removed = [...pool.values()].flat()

  interface Candidate { removed: T, added: T, similarity: number, score: number }
  const candidates: Candidate[] = []
  for (const r of removed) {
    for (const a of added) {
      if (r.format !== a.format)
        continue
      const sim = similarity(r.skeleton, a.skeleton)
      if (sim < threshold)
        continue
      const penalty = (r.kind === a.kind ? 0 : KIND_PENALTY) + POSITION_WEIGHT * Math.abs(position.get(r)! - position.get(a)!)
      candidates.push({ removed: r, added: a, similarity: sim, score: sim - penalty })
    }
  }
  candidates.sort((x, y) => y.score - x.score)
  const byRemoved = Map.groupBy(candidates, c => c.removed)
  const byAdded = Map.groupBy(candidates, c => c.added)

  const used = new Set<T>()
  const modified: Array<Modification<T>> = []
  for (const c of candidates) {
    if (used.has(c.removed) || used.has(c.added))
      continue
    used.add(c.removed)
    used.add(c.added)
    const rivals = [
      ...byRemoved.get(c.removed)!.filter(o => o.added.hash !== c.added.hash),
      ...byAdded.get(c.added)!.filter(o => o.removed.hash !== c.removed.hash),
    ]
    modified.push({
      before: c.removed,
      after: c.added,
      similarity: c.similarity,
      ambiguous: rivals.some(o => o.score >= c.score - margin),
    })
  }
  return {
    unchanged,
    added: added.filter(s => !used.has(s)),
    removed: removed.filter(s => !used.has(s)),
    modified,
  }
}
