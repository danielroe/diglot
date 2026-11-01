export type GrammarToken
  = | { type: 'char', value: string, escaped: boolean, at: number }
    | { type: 'marker', value: Marker, at: number }
    | { type: 'open' | 'close', id: number, at: number }

type Marker = '**' | '__' | '~~' | '*' | '_'

const PLACEHOLDER_RE = /^\{(\/?)(\d+)\}/
const MARKER_RE = /^(?:\*\*|__|~~|\*|_)/
const ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

/** Splits a skeleton into characters, emphasis markers and placeholder tokens. */
export function tokenize(input: string, options: { markers?: boolean } = {}): GrammarToken[] {
  const markers = options.markers ?? true
  const tokens: GrammarToken[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (markers && ch === '\\' && ESCAPABLE.has(input[i + 1] ?? '')) {
      tokens.push({ type: 'char', value: input[i + 1]!, escaped: true, at: i })
      i += 2
      continue
    }
    const rest = input.slice(i, i + 12)
    const ph = PLACEHOLDER_RE.exec(rest)
    if (ph) {
      tokens.push({ type: ph[1] ? 'close' : 'open', id: Number(ph[2]), at: i })
      i += ph[0].length
      continue
    }
    const marker = markers ? MARKER_RE.exec(rest) : null
    if (marker) {
      tokens.push({ type: 'marker', value: marker[0] as Marker, at: i })
      i += marker[0].length
      continue
    }
    tokens.push({ type: 'char', value: ch, escaped: false, at: i })
    i++
  }
  return tokens
}
