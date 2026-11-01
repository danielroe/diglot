export function wordDiff (a: string, b: string): string {
  const x = a.split(/\s+/).filter(Boolean)
  const y = b.split(/\s+/).filter(Boolean)
  const n = x.length
  const m = y.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let del: string[] = []
  let ins: string[] = []
  const flush = () => {
    if (del.length) { out.push(`[-${del.join(' ')}-]`) }
    if (ins.length) { out.push(`{+${ins.join(' ')}+}`) }
    del = []
    ins = []
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { flush(); out.push(x[i]!); i++; j++ }
    else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) { ins.push(y[j]!); j++ }
    else { del.push(x[i]!); i++ }
  }
  flush()
  return out.join(' ')
}

export function sentences (text: string, locale: string): string[] {
  return [...new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text)].map(s => s.segment.trim()).filter(Boolean)
}
