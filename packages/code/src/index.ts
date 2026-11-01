import type { ApplyReport, InlineNode, Segment, SegmentDraft, Translations } from '@diglot/core'
import { buildSegment, createReport, resolveTranslation, tally } from '@diglot/core'
import { resolveLanguage, scanComments } from './scan.ts'

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
const TWO_WORDS_RE = /(?:^|\s)\p{P}*\p{L}{2}[\p{L}\p{N}'’-]*(?:[!"#%&()*,./:;?@[\\\]_{}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061D-\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1B7D\u1B7E\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2018\u201A-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u2E52-\u2E5D\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65\u{10100}-\u{10102}\u{1039F}\u{103D0}\u{1056F}\u{10857}\u{1091F}\u{1093F}\u{10A50}-\u{10A58}\u{10A7F}\u{10AF0}-\u{10AF6}\u{10B39}-\u{10B3F}\u{10B99}-\u{10B9C}\u{10EAD}\u{10F55}-\u{10F59}\u{10F86}-\u{10F89}\u{11047}-\u{1104D}\u{110BB}\u{110BC}\u{110BE}-\u{110C1}\u{11140}-\u{11143}\u{11174}\u{11175}\u{111C5}-\u{111C8}\u{111CD}\u{111DB}\u{111DD}-\u{111DF}\u{11238}-\u{1123D}\u{112A9}\u{1144B}-\u{1144F}\u{1145A}\u{1145B}\u{1145D}\u{114C6}\u{115C1}-\u{115D7}\u{11641}-\u{11643}\u{11660}-\u{1166C}\u{116B9}\u{1173C}-\u{1173E}\u{1183B}\u{11944}-\u{11946}\u{119E2}\u{11A3F}-\u{11A46}\u{11A9A}-\u{11A9C}\u{11A9E}-\u{11AA2}\u{11B00}-\u{11B09}\u{11C41}-\u{11C45}\u{11C70}\u{11C71}\u{11EF7}\u{11EF8}\u{11F43}-\u{11F4F}\u{11FFF}\u{12470}-\u{12474}\u{12FF1}\u{12FF2}\u{16A6E}\u{16A6F}\u{16AF5}\u{16B37}-\u{16B3B}\u{16B44}\u{16E97}-\u{16E9A}\u{16FE2}\u{1BC9F}\u{1DA87}-\u{1DA8B}\u{1E95E}\u{1E95F}]\p{P}*)?\s+\p{P}*\p{L}{2,}/u

/** True for comment text a reader would want translated: two or more words, not a directive or commented-out code. */
export function isProseComment(text: string): boolean {
  if (DIRECTIVE_RE.test(text) || CODE_LIKE_RE.test(text))
    return false
  return TWO_WORDS_RE.test(text.replace(/(`+)[^`]+\1|https?:\/\/\S+/g, ' '))
}

/** Finds the prose comment lines of a code block. Twoslash directives and tool pragmas are excluded. */
export function findComments(code: string, language: string): CodeComment[] {
  const comments: CodeComment[] = []
  for (const raw of scanComments(code, language)) {
    let offset = raw.start
    for (const piece of code.slice(raw.start, raw.end).split('\n')) {
      const lead = raw.style === 'line' ? LINE_LEAD_RE : offset === raw.start ? FIRST_BLOCK_LEAD_RE : BLOCK_LEAD_RE
      const prefix = lead.exec(piece)![0].length
      let body = piece.slice(prefix).replace(/[ \t\r]+$/, '')
      const notation = NOTATION_RE.exec(body)
      if (notation)
        body = body.slice(0, notation.index)
      if (body && isProseComment(body)) {
        const start = offset + prefix
        comments.push({ line: lineOf(code, start), start, end: start + body.length, text: body })
      }
      offset += piece.length + 1
    }
  }
  return comments
}

function lineOf(code: string, offset: number): number {
  let line = 0
  for (let i = code.indexOf('\n'); i >= 0 && i < offset; i = code.indexOf('\n', i + 1))
    line++
  return line
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
