export interface SentenceDiff {
  before: string[]
  after: string[]
  /** Indexes into `after` of sentences that are not in `before`. */
  changed: number[]
  /** Indexes into `before` of sentences that are not in `after`. */
  dropped: number[]
}

const segmenters = new Map<string, Intl.Segmenter>()

/** Splits text into trimmed sentences with `Intl.Segmenter`. */
export function splitSentences(text: string, locale = 'en'): string[] {
  let segmenter = segmenters.get(locale)
  if (!segmenter)
    segmenters.set(locale, segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' }))
  return [...segmenter.segment(text)].map(s => s.segment.trim()).filter(Boolean)
}

/** Longest-common-subsequence diff over the sentences of two texts. */
export function sentenceDiff(beforeText: string, afterText: string, locale = 'en'): SentenceDiff {
  const before = splitSentences(beforeText, locale)
  const after = splitSentences(afterText, locale)
  const lcs = Array.from({ length: before.length + 1 }, () => Array.from<number>({ length: after.length + 1 }).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--)
      lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  }
  const keptBefore = new Set<number>()
  const keptAfter = new Set<number>()
  for (let i = 0, j = 0; i < before.length && j < after.length;) {
    if (before[i] === after[j]) {
      keptBefore.add(i++)
      keptAfter.add(j++)
    }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i++
    }
    else {
      j++
    }
  }
  return {
    before,
    after,
    changed: after.flatMap((_, j) => keptAfter.has(j) ? [] : [j]),
    dropped: before.flatMap((_, i) => keptBefore.has(i) ? [] : [i]),
  }
}
