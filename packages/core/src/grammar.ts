/** `text` is a run of unescaped characters; `char` is one escaped character. */
export type GrammarToken
  = | { type: 'text', value: string, at: number }
    | { type: 'char', value: string, escaped: true, at: number }
    | { type: 'marker', value: Marker, at: number }
    | { type: 'open' | 'close', id: number, at: number }

type Marker = '**' | '__' | '~~' | '*' | '_'

const ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')
/** Longest placeholder token, `{/123456789}`. */
const PLACEHOLDER_SPAN = 12
const SPECIAL_RE = /[\\{*_~]/g
const BRACE_RE = /\{/g

/** Splits a skeleton into runs of text, escaped characters, emphasis markers and placeholder tokens. */
export function tokenize(input: string, options: { markers?: boolean } = {}): GrammarToken[] {
  const markers = options.markers ?? true
  const tokens: GrammarToken[] = []
  const length = input.length
  let run = 0
  const flush = (end: number) => {
    if (end > run)
      tokens.push({ type: 'text', value: input.slice(run, end), at: run })
  }
  const special = markers ? SPECIAL_RE : BRACE_RE
  let i = 0
  while (i < length) {
    special.lastIndex = i
    if (!special.test(input))
      break
    i = special.lastIndex - 1
    const ch = input[i]!
    if (markers && ch === '\\' && i + 1 < length && ESCAPABLE.has(input[i + 1]!)) {
      flush(i)
      tokens.push({ type: 'char', value: input[i + 1]!, escaped: true, at: i })
      run = i += 2
      continue
    }
    if (ch === '{') {
      const end = placeholderEnd(input, i)
      if (end > 0) {
        flush(i)
        const close = input.charCodeAt(i + 1) === 0x2F
        tokens.push({ type: close ? 'close' : 'open', id: Number(input.slice(close ? i + 2 : i + 1, end)), at: i })
        run = i = end + 1
        continue
      }
    }
    else if (markers && (ch === '*' || ch === '_' || ch === '~')) {
      const double = input[i + 1] === ch
      if (double || ch !== '~') {
        flush(i)
        tokens.push({ type: 'marker', value: (double ? ch + ch : ch) as Marker, at: i })
        run = i += double ? 2 : 1
        continue
      }
    }
    i++
  }
  flush(length)
  return tokens
}

/** Index of the `}` closing a placeholder token starting at `start`, or -1. */
function placeholderEnd(input: string, start: number): number {
  const limit = Math.min(input.length, start + PLACEHOLDER_SPAN)
  let j = start + 1
  if (input.charCodeAt(j) === 0x2F)
    j++
  const digits = j
  while (j < limit) {
    const code = input.charCodeAt(j)
    if (code < 0x30 || code > 0x39)
      break
    j++
  }
  return j > digits && j < limit && input.charCodeAt(j) === 0x7D ? j : -1
}
