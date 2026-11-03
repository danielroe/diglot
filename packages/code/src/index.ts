import type { ApplyReport, InlineNode, Segment, SegmentDraft, Translations } from '@diglot/core'
import { buildSegment, createReport, resolveTranslation, tally } from '@diglot/core'
import { resolveLanguage, scanComments } from './scan.ts'
import { hasTwoWords } from './words.ts'

export { resolveLanguage }

/** One line of comment text in a code block. `[start, end)` are offsets of the text in the code. */
export interface CodeComment {
  /** 0-based line of the comment text. */
  line: number
  start: number
  end: number
  text: string
}

const DIRECTIVE_RE = /^(?:\^[?|^]|@|---cut|!|<reference\b|#?(?:end)?region\b|eslint-|prettier-ignore|biome-ignore|oxlint-|istanbul\b|c8\b|webpack[A-Z]|#__PURE__|global\s|jshint|noinspection|ts-)/
const LINE_LEAD_RE = /^\/?[ \t]*/
const FIRST_BLOCK_LEAD_RE = /^\*?[ \t]*/
const BLOCK_LEAD_RE = /^[ \t]*(?:\*(?!\/))?[ \t]*/
const NOTATION_RE = /\s*\[!code\b[^\]]*\]\s*$/
const CODE_LIKE_RE = /^(?:import|export|const|let|var|return|await|function|async|console\.|module\.|require\()|[;{,]$|=>|===?|\?\.|\s=\s|^<\/?[a-z]|^[\w$'"-]+\s*:\s*(?:true|false|null|[\d'"{[])|^[{[]|[\w$]\([^)]*\)$/i

/** True for comment text a reader would want translated: two or more words, not a directive or commented-out code. */
export function isProseComment(text: string): boolean {
  if (DIRECTIVE_RE.test(text) || CODE_LIKE_RE.test(text))
    return false
  return hasTwoWords(text.replace(/(`+)[^`]+\1|https?:\/\/\S+/g, ' '))
}

/** Finds the prose comment lines of a code block. Twoslash directives and tool pragmas are excluded. */
export function findComments(code: string, language: string): CodeComment[] {
  const comments: CodeComment[] = []
  let line = 0
  let scanned = 0
  for (const raw of scanComments(code, language)) {
    let offset = raw.start
    for (const piece of code.slice(raw.start, raw.end).split('\n')) {
      const lead = raw.style === 'line' ? LINE_LEAD_RE : offset === raw.start ? FIRST_BLOCK_LEAD_RE : BLOCK_LEAD_RE
      const prefix = lead.exec(piece)![0].length
      let body = trimTrailingWhitespace(piece.slice(prefix))
      const notation = NOTATION_RE.exec(body)
      if (notation)
        body = body.slice(0, notation.index)
      if (body && isProseComment(body)) {
        const start = offset + prefix
        line = countLinesTo(code, line, scanned, start)
        scanned = start
        comments.push({ line, start, end: start + body.length, text: body })
      }
      offset += piece.length + 1
    }
  }
  return comments
}

function countLinesTo(code: string, line: number, from: number, to: number): number {
  for (let i = code.indexOf('\n', from); i >= 0 && i < to; i = code.indexOf('\n', i + 1))
    line++
  return line
}

function trimTrailingWhitespace(value: string): string {
  let end = value.length
  while (end > 0) {
    const char = value.charCodeAt(end - 1)
    if (char !== 0x20 && char !== 0x09 && char !== 0x0D)
      break
    end--
  }
  return end === value.length ? value : value.slice(0, end)
}

export interface CommentContext {
  /** Enclosing headings, outermost first. */
  headingTrail?: string[]
  containers?: string[]
  /** 1-based line of the first code line in the document, for positions. */
  firstLine?: number
}

/** Converts a comment to a `code-comment` draft. Inline code and URLs in the comment become placeholders. */
export function commentDraft(comment: CodeComment, language: string, context: CommentContext = {}): SegmentDraft {
  const line = (context.firstLine ?? 1) + comment.line
  return {
    kind: 'code-comment',
    format: 'plain',
    content: commentInline(comment.text),
    context: { headingTrail: context.headingTrail ?? [], containers: context.containers ?? [], detail: language },
    position: { startLine: line, endLine: line, precision: context.firstLine === undefined ? 'block' : 'node' },
  }
}

function commentInline(text: string): InlineNode[] {
  const out: InlineNode[] = []
  let last = 0
  for (const match of text.matchAll(/(`+)[^`]+\1|https?:\/\/[^\s)>\]]+/g)) {
    if (match.index > last)
      out.push({ type: 'text', value: text.slice(last, match.index) })
    out.push({ type: 'atomic', kind: match[0].startsWith('`') ? 'code' : 'link', source: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length)
    out.push({ type: 'text', value: text.slice(last) })
  return out
}

/** Replaces comment texts. Each replacement must be a single line without comment terminators. */
export function replaceComments(code: string, replacements: Array<{ comment: CodeComment, text: string }>): string {
  let out = code
  for (const { comment, text } of [...replacements].sort((a, b) => b.comment.start - a.comment.start))
    out = out.slice(0, comment.start) + text + out.slice(comment.end)
  return out
}

export interface ExtractedCode {
  comments: CodeComment[]
  segments: Segment[]
}

/** Extracts the comment segments of a standalone code block. */
export function extractCode(code: string, language: string, file = ''): ExtractedCode {
  const comments: CodeComment[] = []
  const segments: Segment[] = []
  for (const comment of findComments(code, language)) {
    const segment = buildSegment(commentDraft(comment, language), { file, index: segments.length })
    if (segment) {
      comments.push(comment)
      segments.push(segment)
    }
  }
  return { comments, segments }
}

export interface AppliedCode {
  code: string
  report: ApplyReport
}

/** Applies translated comment skeletons to a standalone code block. */
export function applyCode(code: string, language: string, translations: Translations, file = ''): AppliedCode {
  const { comments, segments } = extractCode(code, language, file)
  const report = createReport()
  const replacements: Array<{ comment: CodeComment, text: string }> = []
  segments.forEach((segment, i) => {
    const resolution = resolveTranslation(segment, translations)
    tally(report, segment, resolution)
    if (resolution.status === 'ok')
      replacements.push({ comment: comments[i]!, text: resolution.text })
  })
  return { code: replaceComments(code, replacements), report }
}
