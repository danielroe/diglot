import type { Segment } from './types.ts'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

type Token =
  | { type: 'text' }
  | { type: 'marker', value: string }
  | { type: 'open' | 'close', id: number }

const SINGLE_LINE_KINDS = new Set(['heading', 'table-cell', 'prop', 'frontmatter', 'navigation', 'code-label', 'image-alt'])

/**
 * Checks a translated skeleton against the translation grammar: text, emphasis markers
 * (`**`, `*`, `__`, `_`, `~~`) and exactly the placeholders of the source segment.
 * Anything that would parse as other markdown (code, links, HTML, components,
 * bindings, block syntax) is rejected; literal punctuation must be backslash-escaped.
 */
export function validate(translation: string, segment: Pick<Segment, 'kind' | 'format' | 'placeholders'>): ValidationResult {
  const errors: string[] = []
  if (!translation.trim()) errors.push('empty translation')
  if (SINGLE_LINE_KINDS.has(segment.kind) && /\n/.test(translation)) errors.push(`${segment.kind} must be a single line`)
  if (segment.format === 'plain') return { ok: !errors.length, errors }

  if (/\n[ \t]*\n/.test(translation)) errors.push('blank line would split the paragraph')
  if (/^(?:#{1,6}|[>+=-]|\d+[.)])(?:\s|$)/m.test(translation)) errors.push('line starts with block syntax')

  const tokens = tokenize(translation, segment.kind, errors)
  checkPlaceholders(tokens, segment.placeholders, errors)
  const paired = new Set(segment.placeholders.filter(p => p.close !== undefined).map(p => p.id))
  checkNesting(tokens, paired, errors)
  return { ok: !errors.length, errors }
}

function tokenize(input: string, kind: string, errors: string[]): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const rest = input.slice(i)
    const ch = input[i]!
    let m: RegExpExecArray | null
    if (ch === '\\' && i + 1 < input.length) {
      tokens.push({ type: 'text' })
      i += 2
    } else if ((m = /^\{(\/?)(\d+)\}/.exec(rest))) {
      tokens.push({ type: m[1] ? 'close' : 'open', id: Number(m[2]) })
      i += m[0].length
    } else if ((m = /^(\*\*|__|~~|\*|_)/.exec(rest))) {
      tokens.push({ type: 'marker', value: m[1]! })
      i += m[0].length
    } else {
      const error = forbidden(input, i, kind)
      if (error) errors.push(`${error} at ${i}`)
      tokens.push({ type: 'text' })
      i++
    }
  }
  return tokens
}

function forbidden(input: string, i: number, kind: string): string | undefined {
  const ch = input[i]!
  const next = input[i + 1] ?? ''
  const prev = input[i - 1] ?? ' '
  if (ch === '`') return 'inline code'
  if (ch === '[' || ch === ']') return 'link syntax'
  if (ch === '<' && /[a-z/!?]/i.test(next)) return 'raw HTML'
  if (ch === '{') return next === '{' ? 'binding' : 'attribute or unknown placeholder syntax'
  if (ch === '}') return 'unbalanced brace'
  if (ch === ':' && /\s/.test(prev) && /[a-z]/i.test(next)) return 'inline component'
  if (ch === '|' && kind === 'table-cell') return 'table pipe'
  if (ch === '&' && /^&#?\w+;/.test(input.slice(i))) return 'HTML entity'
  if (/^(?:https?:\/\/|www\.)/i.test(input.slice(i)) && /\s|^/.test(prev)) return 'bare URL (would autolink)'
}

function checkPlaceholders(tokens: Token[], placeholders: Segment['placeholders'], errors: string[]) {
  const seen = new Map<string, number>()
  for (const t of tokens) {
    if (t.type === 'open' || t.type === 'close') {
      const key = `${t.type}:${t.id}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  for (const ph of placeholders) {
    const paired = ph.close !== undefined
    if ((seen.get(`open:${ph.id}`) ?? 0) !== 1) errors.push(`placeholder {${ph.id}} must appear exactly once`)
    if (paired && (seen.get(`close:${ph.id}`) ?? 0) !== 1) errors.push(`closing {/${ph.id}} must appear exactly once`)
    if (!paired && seen.has(`close:${ph.id}`)) errors.push(`{${ph.id}} is not a paired placeholder`)
    seen.delete(`open:${ph.id}`)
    seen.delete(`close:${ph.id}`)
  }
  for (const key of seen.keys()) errors.push(`unknown placeholder ${key.replace(/^open:/, '{').replace(/^close:/, '{/')}}`)
}

function checkNesting(tokens: Token[], paired: Set<number>, errors: string[]) {
  const stack: string[] = []
  for (const t of tokens) {
    if (t.type === 'marker') {
      if (stack.at(-1) === t.value) stack.pop()
      else stack.push(t.value)
    } else if (t.type === 'open' && paired.has(t.id)) {
      stack.push(`{${t.id}}`)
    } else if (t.type === 'close') {
      if (stack.at(-1) === `{${t.id}}`) stack.pop()
      else errors.push(`{/${t.id}} closes across ${stack.at(-1) ?? 'nothing'}`)
    }
  }
  for (const open of stack) errors.push(`unclosed ${open}`)
}
