const LETTER = 1
const NUMBER = 2
const PUNCT = 4
const JOINER = 8

const ASCII_KINDS = new Uint8Array(128)
for (let code = 0x41; code <= 0x5A; code++)
  ASCII_KINDS[code] = ASCII_KINDS[code + 0x20] = LETTER
for (let code = 0x30; code <= 0x39; code++)
  ASCII_KINDS[code] = NUMBER
for (const char of '!"#%&()*,./:;?@[\\]_{}')
  ASCII_KINDS[char.charCodeAt(0)] = PUNCT
ASCII_KINDS[0x27] = ASCII_KINDS[0x2D] = PUNCT | JOINER

const LETTER_RE = /\p{L}/uy
const NUMBER_RE = /\p{N}/uy
const PUNCT_RE = /\p{P}/uy

function kindAt(text: string, at: number): number {
  const code = text.charCodeAt(at)
  if (code < 0x80)
    return ASCII_KINDS[code]!
  if (code === 0x2019)
    return PUNCT | JOINER
  LETTER_RE.lastIndex = NUMBER_RE.lastIndex = PUNCT_RE.lastIndex = at
  return LETTER_RE.test(text) ? LETTER : NUMBER_RE.test(text) ? NUMBER : PUNCT_RE.test(text) ? PUNCT : 0
}

function after(text: string, at: number): number {
  const code = text.charCodeAt(at)
  if (code >= 0xD800 && code < 0xDC00) {
    const low = text.charCodeAt(at + 1)
    if (low >= 0xDC00 && low < 0xE000)
      return at + 2
  }
  return at + 1
}

function skip(text: string, at: number, kinds: number): number {
  while (at < text.length && kindAt(text, at) & kinds)
    at = after(text, at)
  return at
}

function letters(text: string, at: number): number {
  for (let n = 0; n < 2; n++) {
    if (at >= text.length || !(kindAt(text, at) & LETTER))
      return -1
    at = after(text, at)
  }
  return at
}

function isWord(token: string): boolean {
  let at = letters(token, skip(token, 0, PUNCT))
  if (at < 0)
    return false
  at = skip(token, at, LETTER | NUMBER | JOINER)
  if (at < token.length && kindAt(token, at) & PUNCT)
    at = skip(token, after(token, at), PUNCT)
  return at === token.length
}

/**
 * True when `text` has a word of two or more letters (then letters, digits, apostrophes or
 * hyphens, then punctuation) followed by whitespace and a word that starts with two letters.
 * Leading punctuation is allowed in both words.
 */
export function hasTwoWords(text: string): boolean {
  const tokens = text.split(/\s+/)
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isWord(tokens[i]!) && letters(tokens[i + 1]!, skip(tokens[i + 1]!, 0, PUNCT)) >= 0)
      return true
  }
  return false
}
