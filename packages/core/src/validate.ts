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
    | 'rejected'

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
const LINE_BREAK_RE = /[\n\r\u2028\u2029]/
const BLOCK_START_RE = /^[ \t]*(?:#{1,6}|[>+=-]|\d+[.)])(?:[ \t]|$)/
const BLOCK_LINE_RE = new RegExp(BLOCK_START_RE.source, 'm')
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
    const breaks = LINE_BREAK_RE.test(translation)
    if (breaks && /\n[ \t]*\n/.test(translation))
      error('blank-line', 'blank line would split the unit')
    if ((breaks ? BLOCK_LINE_RE : BLOCK_START_RE).test(translation))
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
    const found = count(re, translation)
    if (found && found > count(re, source))
      error('markup', `${name} not present in the source`)
  }
}

function count(re: RegExp, text: string): number {
  let n = 0
  re.lastIndex = 0
  while (re.test(text))
    n++
  return n
}

const ENTITY_RE = /&#?\w+;/y
const SIGNIFICANT_RE = /[`[\]<{}:|&]|https?:\/\/|www\./gi

/** Tokens cover the input without gaps, so each token ends where the next begins. */
function checkCharacters(input: string, tokens: GrammarToken[], kind: SegmentKind, error: Report) {
  let index = 0
  SIGNIFICANT_RE.lastIndex = 0
  for (let match = SIGNIFICANT_RE.exec(input); match; match = SIGNIFICANT_RE.exec(input)) {
    const i = match.index
    while (index + 1 < tokens.length && tokens[index + 1]!.at <= i)
      index++
    if (tokens[index]?.type !== 'text')
      continue
    switch (match[0]) {
      case '`':
        error('inline-code', 'inline code', i)
        break
      case '[':
      case ']':
        error('link-syntax', 'link syntax', i)
        break
      case '<':
        if (/[a-z/!?]/i.test(input[i + 1] ?? ''))
          error('html', 'raw HTML', i)
        break
      case '{':
        error(input[i + 1] === '{' ? 'binding' : 'brace', input[i + 1] === '{' ? 'binding' : 'unknown placeholder or attribute syntax', i)
        break
      case '}':
        error('brace', 'unbalanced brace', i)
        break
      case ':':
        if (/\s/.test(input[i - 1] ?? ' ') && /[a-z]/i.test(input[i + 1] ?? ''))
          error('component', 'inline component', i)
        break
      case '|':
        if (kind === 'table-cell')
          error('table-pipe', 'table pipe', i)
        break
      case '&':
        ENTITY_RE.lastIndex = i
        if (ENTITY_RE.test(input))
          error('entity', 'HTML entity', i)
        break
      default:
        error('bare-url', 'bare URL would autolink', i)
    }
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
  const paired = new Set<number>()
  for (const placeholder of placeholders) {
    if (placeholder.close !== undefined)
      paired.add(placeholder.id)
  }
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
