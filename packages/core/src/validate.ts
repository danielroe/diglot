import type { GrammarToken } from './grammar.ts'
import type { Placeholder, Segment, SegmentKind } from './types.ts'
import { tokenize } from './grammar.ts'

export type IssueCode
  = | 'empty'
    | 'multiline'
    | 'blank-line'
    | 'block-syntax'
    | 'inline-code'
    | 'link-syntax'
    | 'html'
    | 'binding'
    | 'brace'
    | 'component'
    | 'table-pipe'
    | 'entity'
    | 'bare-url'
    | 'markup'
    | 'comment-terminator'
    | 'missing-placeholder'
    | 'duplicate-placeholder'
    | 'unknown-placeholder'
    | 'not-paired'
    | 'nesting'
    | 'unclosed'
    | 'unaddressable'

export interface ValidationIssue {
  code: IssueCode
  message: string
  /** Offset in the translation, when the issue has one. */
  at?: number
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
  /** Accepted, but worth a reviewer's attention. */
  warnings: ValidationIssue[]
}

/** The parts of a segment that `validate` reads. */
export type ValidationTarget = Pick<Segment, 'kind' | 'format' | 'placeholders'> & { skeleton?: string }

const SINGLE_LINE: ReadonlySet<SegmentKind> = new Set(['heading', 'table-cell', 'prop', 'frontmatter', 'navigation', 'code-label', 'code-comment', 'image-alt'])
const REPEATABLE = new Set(['code', 'binding'])
const PLAIN_MARKUP: Array<[RegExp, string]> = [
  [/`/g, 'backtick'],
  [/\*\*|__|~~/g, 'emphasis marker'],
  [/<\/?[a-z][^>]*>/gi, 'HTML tag'],
  [/\]\(/g, 'markdown link'],
  [/\{\{|\}\}/g, 'binding'],
]

/**
 * Checks a translated skeleton against the translation grammar of its source segment.
 *
 * Markdown segments accept text, emphasis markers (`**`, `*`, `__`, `_`, `~~`) and the
 * source's placeholders. Anything that would parse as other markdown (code, links, HTML,
 * components, bindings, block syntax) is rejected; literal punctuation must be escaped.
 * Plain segments accept text and the source's placeholders, on one line, without markup
 * the source does not have. Code comments additionally reject comment terminators.
 */
export function validate(translation: string, segment: ValidationTarget): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const error = (code: IssueCode, message: string, at?: number) => errors.push({ code, message, ...(at === undefined ? {} : { at }) })

  if (!translation.trim())
    error('empty', 'translation is empty')
  const plain = segment.format === 'plain'
  if ((plain || SINGLE_LINE.has(segment.kind)) && /[\r\n]/.test(translation))
    error('multiline', `${segment.kind} must be a single line`)
  if (segment.kind === 'code-comment') {
    const terminator = /\*\/|-->/.exec(translation)
    if (terminator)
      error('comment-terminator', `comment terminator ${terminator[0]}`, terminator.index)
  }

  const tokens = tokenize(translation, { markers: !plain })
  if (plain) {
    checkPlainMarkup(translation, segment.skeleton ?? '', error)
  }
  else {
    if (/\n[ \t]*\n/.test(translation))
      error('blank-line', 'blank line would split the unit')
    if (/^[ \t]*(?:#{1,6}|[>+=-]|\d+[.)])(?:[ \t]|$)/m.test(translation))
      error('block-syntax', 'line starts with block syntax')
    checkCharacters(translation, tokens, segment.kind, error)
  }
  checkPlaceholders(tokens, segment.placeholders, error, warnings)
  if (!plain)
    checkNesting(tokens, segment.placeholders, error)
  return { ok: errors.length === 0, errors, warnings }
}

type Report = (code: IssueCode, message: string, at?: number) => void

function checkPlainMarkup(translation: string, source: string, error: Report) {
  for (const [re, name] of PLAIN_MARKUP) {
    const found = translation.match(re)?.length ?? 0
    const allowed = source.match(re)?.length ?? 0
    if (found > allowed)
      error('markup', `${name} not present in the source`)
  }
}

function checkCharacters(input: string, tokens: GrammarToken[], kind: SegmentKind, error: Report) {
  for (const token of tokens) {
    if (token.type !== 'char' || token.escaped)
      continue
    const i = token.at
    const ch = token.value
    const next = input[i + 1] ?? ''
    const prev = input[i - 1] ?? ' '
    if (ch === '`')
      error('inline-code', 'inline code', i)
    else if (ch === '[' || ch === ']')
      error('link-syntax', 'link syntax', i)
    else if (ch === '<' && /[a-z/!?]/i.test(next))
      error('html', 'raw HTML', i)
    else if (ch === '{')
      error(next === '{' ? 'binding' : 'brace', next === '{' ? 'binding' : 'unknown placeholder or attribute syntax', i)
    else if (ch === '}')
      error('brace', 'unbalanced brace', i)
    else if (ch === ':' && /\s/.test(prev) && /[a-z]/i.test(next))
      error('component', 'inline component', i)
    else if (ch === '|' && kind === 'table-cell')
      error('table-pipe', 'table pipe', i)
    else if (ch === '&' && /^&#?\w+;/.test(input.slice(i)))
      error('entity', 'HTML entity', i)
    else if (/^(?:https?:\/\/|www\.)/i.test(input.slice(i, i + 8)))
      error('bare-url', 'bare URL would autolink', i)
  }
}

function checkPlaceholders(tokens: GrammarToken[], placeholders: Placeholder[], error: Report, warnings: ValidationIssue[]) {
  const seen = new Map<string, number>()
  for (const token of tokens) {
    if (token.type === 'open' || token.type === 'close') {
      const key = `${token.type === 'close' ? '/' : ''}${token.id}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  for (const placeholder of placeholders) {
    const paired = placeholder.close !== undefined
    const opens = seen.get(`${placeholder.id}`) ?? 0
    if (opens === 0)
      error('missing-placeholder', `{${placeholder.id}} is missing`)
    else if (opens > 1 && !paired && REPEATABLE.has(placeholder.type))
      warnings.push({ code: 'duplicate-placeholder', message: `{${placeholder.id}} appears ${opens} times` })
    else if (opens > 1)
      error('duplicate-placeholder', `{${placeholder.id}} must appear once`)
    const closes = seen.get(`/${placeholder.id}`) ?? 0
    if (paired && closes !== opens)
      error(closes ? 'duplicate-placeholder' : 'missing-placeholder', `{/${placeholder.id}} must close {${placeholder.id}}`)
    if (!paired && closes)
      error('not-paired', `{${placeholder.id}} is not a paired placeholder`)
    seen.delete(`${placeholder.id}`)
    seen.delete(`/${placeholder.id}`)
  }
  for (const key of seen.keys())
    error('unknown-placeholder', `unknown placeholder {${key}}`)
}

function checkNesting(tokens: GrammarToken[], placeholders: Placeholder[], error: Report) {
  const paired = new Set(placeholders.filter(p => p.close !== undefined).map(p => p.id))
  const stack: string[] = []
  for (const token of tokens) {
    if (token.type === 'marker') {
      if (stack.at(-1) === token.value)
        stack.pop()
      else
        stack.push(token.value)
    }
    else if (token.type === 'open' && paired.has(token.id)) {
      stack.push(`{${token.id}}`)
    }
    else if (token.type === 'close' && paired.has(token.id)) {
      if (stack.at(-1) === `{${token.id}}`)
        stack.pop()
      else
        error('nesting', `{/${token.id}} closes across ${stack.at(-1) ?? 'nothing'}`, token.at)
    }
  }
  for (const open of stack)
    error('unclosed', `unclosed ${open}`)
}
