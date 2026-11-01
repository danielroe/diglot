/** A raw comment found by a tokenizer: `[start, end)` covers the comment body without its delimiters. */
export interface RawComment {
  start: number
  end: number
  style: 'line' | 'block'
}

type Scanner = (code: string, out: RawComment[]) => void

interface CStyle {
  line: boolean
  strings: string
  template: boolean
  regex: boolean
}

const JS: CStyle = { line: true, strings: '"\'', template: true, regex: true }
const JSON5: CStyle = { line: true, strings: '"\'', template: false, regex: false }
const CSS: CStyle = { line: false, strings: '"\'', template: false, regex: false }
const SCSS: CStyle = { line: true, strings: '"\'', template: false, regex: false }

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'])

/** With `close`, returns after the `}` that closes a template expression. */
function scanCStyle(code: string, syntax: CStyle, out: RawComment[], i = 0, close = false): number {
  let depth = 0
  let last = ''
  let word = ''
  while (i < code.length) {
    const ch = code[i]!
    const next = code[i + 1]
    if (syntax.line && ch === '/' && next === '/') {
      const end = lineEnd(code, i)
      out.push({ start: i + 2, end, style: 'line' })
      i = end
      continue
    }
    if (ch === '/' && next === '*') {
      const endAt = code.indexOf('*/', i + 2)
      const end = endAt < 0 ? code.length : endAt
      out.push({ start: i + 2, end, style: 'block' })
      i = endAt < 0 ? code.length : endAt + 2
      continue
    }
    if (syntax.strings.includes(ch)) {
      i = skipString(code, i, ch)
      last = ch
      continue
    }
    if (syntax.template && ch === '`') {
      i = skipTemplate(code, i, syntax, out)
      last = ch
      continue
    }
    if (syntax.regex && ch === '/' && regexAllowed(last, word)) {
      const end = skipRegex(code, i)
      if (end > 0) {
        i = end
        last = '/'
        continue
      }
    }
    if (close) {
      if (ch === '{') {
        depth++
      }
      else if (ch === '}') {
        if (depth === 0)
          return i + 1
        depth--
      }
    }
    if (/[\w$]/.test(ch)) {
      word = /[\w$]/.test(last) ? word + ch : ch
      last = ch
    }
    else if (!/\s/.test(ch)) {
      last = ch
      word = ''
    }
    i++
  }
  return i
}

function regexAllowed(last: string, word: string): boolean {
  if (!last)
    return true
  if (/[\w$]/.test(last))
    return REGEX_KEYWORDS.has(word)
  return !/[)\]}]/.test(last)
}

function skipRegex(code: string, i: number): number {
  let inClass = false
  for (let j = i + 1; j < code.length; j++) {
    const ch = code[j]
    if (ch === '\n')
      return -1
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '[')
      inClass = true
    else if (ch === ']')
      inClass = false
    else if (ch === '/' && !inClass)
      return j + 1
  }
  return -1
}

function skipString(code: string, i: number, quote: string): number {
  for (let j = i + 1; j < code.length; j++) {
    const ch = code[j]
    if (ch === '\\')
      j++
    else if (ch === quote || ch === '\n')
      return j + 1
  }
  return code.length
}

function skipTemplate(code: string, i: number, syntax: CStyle, out: RawComment[]): number {
  for (let j = i + 1; j < code.length; j++) {
    const ch = code[j]
    if (ch === '\\') {
      j++
    }
    else if (ch === '`') {
      return j + 1
    }
    else if (ch === '$' && code[j + 1] === '{') {
      j = scanCStyle(code, syntax, out, j + 2, true) - 1
    }
  }
  return code.length
}

function lineEnd(code: string, i: number): number {
  const end = code.indexOf('\n', i)
  return end < 0 ? code.length : end
}

function scanHash(code: string, out: RawComment[], quotes = '"\''): void {
  let i = 0
  while (i < code.length) {
    const ch = code[i]!
    if (quotes.includes(ch)) {
      i = skipString(code, i, ch)
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(code[i - 1]!)) && code[i - 1] !== '$') {
      const end = lineEnd(code, i)
      out.push({ start: i + 1, end, style: 'line' })
      i = end
      continue
    }
    i++
  }
}

function scanHtml(code: string, out: RawComment[]): void {
  let i = 0
  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const endAt = code.indexOf('-->', i + 4)
      const end = endAt < 0 ? code.length : endAt
      out.push({ start: i + 4, end, style: 'block' })
      i = endAt < 0 ? code.length : endAt + 3
      continue
    }
    const open = code[i] === '<' ? /^<(script|style)\b[^>]*>/i.exec(code.slice(i, i + 200)) : null
    if (open) {
      const tag = open[1]!.toLowerCase()
      const bodyStart = i + open[0].length
      const closeAt = code.toLowerCase().indexOf(`</${tag}`, bodyStart)
      const bodyEnd = closeAt < 0 ? code.length : closeAt
      const inner: RawComment[] = []
      const lang = /\blang=["']?(\w+)/.exec(open[0])?.[1]
      scanCStyle(code.slice(bodyStart, bodyEnd), tag === 'script' ? JS : lang === 'scss' || lang === 'less' ? SCSS : CSS, inner)
      out.push(...inner.map(c => ({ ...c, start: c.start + bodyStart, end: c.end + bodyStart })))
      i = bodyEnd
      continue
    }
    i++
  }
}

const SCANNERS: Record<string, Scanner> = {
  js: (code, out) => scanCStyle(code, JS, out),
  json5: (code, out) => scanCStyle(code, JSON5, out),
  css: (code, out) => scanCStyle(code, CSS, out),
  scss: (code, out) => scanCStyle(code, SCSS, out),
  html: scanHtml,
  bash: (code, out) => scanHash(code, out),
  yaml: (code, out) => scanHash(code, out),
  toml: (code, out) => scanHash(code, out),
}

const ALIASES: Record<string, string> = {
  'js': 'js',
  'javascript': 'js',
  'mjs': 'js',
  'cjs': 'js',
  'jsx': 'js',
  'ts': 'js',
  'typescript': 'js',
  'mts': 'js',
  'cts': 'js',
  'tsx': 'js',
  'json5': 'json5',
  'jsonc': 'json5',
  'css': 'css',
  'postcss': 'css',
  'scss': 'scss',
  'less': 'scss',
  'html': 'html',
  'htm': 'html',
  'xml': 'html',
  'svg': 'html',
  'vue': 'html',
  'vue-html': 'html',
  'bash': 'bash',
  'sh': 'bash',
  'shell': 'bash',
  'shellscript': 'bash',
  'zsh': 'bash',
  'dotenv': 'bash',
  'env': 'bash',
  'ini': 'bash',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'toml',
}

/** Canonical tokenizer name for a code block language, or `undefined` when unsupported. */
export function resolveLanguage(language: string): string | undefined {
  return ALIASES[language.toLowerCase()]
}

/** Finds every comment in `code`. Unsupported languages have none. */
export function scanComments(code: string, language: string): RawComment[] {
  const scanner = SCANNERS[resolveLanguage(language) ?? '']
  const out: RawComment[] = []
  scanner?.(code, out)
  return out.sort((a, b) => a.start - b.start)
}
