const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

export function splitSentences(text: string): string[] {
  return [...segmenter.segment(text)].map(s => s.segment.trim()).filter(Boolean)
}

export interface SentenceChange {
  before: string[]
  after: string[]
  /** Indexes into `after` of sentences not present (in order) in `before`. */
  changed: number[]
  /** Sentences of `before` that no longer appear. */
  dropped: number[]
}

/** Longest-common-subsequence diff over sentences. */
export function diffSentences(beforeText: string, afterText: string): SentenceChange {
  const before = splitSentences(beforeText)
  const after = splitSentences(afterText)
  const dp = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      dp[i]![j] = before[i] === after[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const keptBefore = new Set<number>()
  const keptAfter = new Set<number>()
  for (let i = 0, j = 0; i < before.length && j < after.length;) {
    if (before[i] === after[j]) {
      keptBefore.add(i++)
      keptAfter.add(j++)
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return {
    before,
    after,
    changed: after.map((_, j) => j).filter(j => !keptAfter.has(j)),
    dropped: before.map((_, i) => i).filter(i => !keptBefore.has(i)),
  }
}
