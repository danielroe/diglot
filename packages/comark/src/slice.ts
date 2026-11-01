import type { ElementNode, Node } from 'comark'
import { isDeepStrictEqual } from 'node:util'
import { children, isElement, parseInline } from './tree.ts'

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const MAX_CANDIDATES = 4

/**
 * Locates inline spans in the source of one block. comark trees carry no inline positions,
 * so spans are found by scanning forward from the previous match; every candidate is
 * checked (by content, or by parsing it back) before it is used.
 */
export class SourceSlicer {
  private cursor = 0
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  /** Source of an inline code span. */
  async code(node: ElementNode): Promise<string | undefined> {
    const content = children(node).filter(c => typeof c === 'string').join('')
    const hasAttrs = Object.keys(node[1]).some(k => k !== '$')
    const re = /`+/g
    re.lastIndex = this.cursor
    for (let m = re.exec(this.text); m; m = re.exec(this.text)) {
      const fence = m[0]
      const close = findFence(this.text, m.index + fence.length, fence.length)
      if (close < 0)
        continue
      if (codeContent(this.text.slice(m.index + fence.length, close)) !== content) {
        re.lastIndex = close + fence.length
        continue
      }
      let end = close + fence.length
      if (hasAttrs) {
        const attrsEnd = this.text[end] === '{' ? balanced(this.text, end, '{', '}') : -1
        if (attrsEnd < 0 || !(await this.verify(this.text.slice(m.index, attrsEnd), node)))
          return
        end = attrsEnd
      }
      return this.take(m.index, end)
    }
  }

  /** Markdown after the text of an inline link, for example `](/docs "title"){target="_blank"}`. */
  async linkClose(node: ElementNode): Promise<string | undefined> {
    const href = String(node[1].href ?? '')
    for (let at = this.text.indexOf('](', this.cursor), tries = 0; at >= 0 && tries < MAX_CANDIDATES; at = this.text.indexOf('](', at + 2), tries++) {
      let end = balanced(this.text, at + 1, '(', ')')
      if (end < 0 || !this.text.slice(at + 2, end).includes(href.split('#')[0]!))
        continue
      if (this.text[end] === '{')
        end = balanced(this.text, end, '{', '}')
      if (end < 0)
        continue
      const close = this.text.slice(at, end)
      const parsed = await parseInline(`[x${close}`)
      if (parsed?.length === 1 && isElement(parsed[0]) && parsed[0][0] === 'a' && isDeepStrictEqual(parsed[0][1], node[1]))
        return this.take(at, end, close)
    }
  }

  /** Source of an image, inline component or inline HTML element, given its rendered markdown. */
  async span(node: ElementNode, rendered: string): Promise<string | undefined> {
    const exact = this.text.indexOf(rendered, this.cursor)
    if (exact >= 0)
      return this.take(exact, exact + rendered.length)
    const [tag, attrs] = node
    const opener = attrs.$?.html ? `<${tag}` : tag === 'img' ? '![' : tag === 'span' ? '[' : `:${tag}`
    for (let at = this.text.indexOf(opener, this.cursor), tries = 0; at >= 0 && tries < MAX_CANDIDATES; at = this.text.indexOf(opener, at + 1), tries++) {
      const end = attrs.$?.html ? htmlEnd(this.text, at, tag) : mdcEnd(this.text, at, opener.length)
      if (end > at && await this.verify(this.text.slice(at, end), node))
        return this.take(at, end)
    }
  }

  private async verify(markdown: string, node: Node): Promise<boolean> {
    const parsed = await parseInline(markdown)
    return parsed?.length === 1 && isDeepStrictEqual(parsed[0], node)
  }

  private take(start: number, end: number, value = this.text.slice(start, end)): string {
    this.cursor = end
    return value
  }
}

function findFence(text: string, from: number, length: number): number {
  const re = /`+/g
  re.lastIndex = from
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === length)
      return m.index
  }
  return -1
}

/** CommonMark code span content: line endings become spaces and one surrounding space is stripped. */
function codeContent(raw: string): string {
  const value = raw.replace(/\r?\n/g, ' ')
  return /^ +(?:[^\n\r \u2028\u2029]|(?:[^\n\r \u2028\u2029].*)?[\n\r\u2028\u2029]).* $/.test(value) ? value.slice(1, -1) : value
}

function balanced(text: string, start: number, open: string, close: string): number {
  let depth = 0
  let quote = ''
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\') {
      i++
    }
    else if (quote) {
      if (ch === quote)
        quote = ''
    }
    else if ((ch === '"' || ch === '\'') && open !== '[') {
      quote = ch
    }
    else if (ch === open) {
      depth++
    }
    else if (ch === close && --depth === 0) {
      return i + 1
    }
    else if (ch === '\n' && text[i + 1] === '\n') {
      return -1
    }
  }
  return -1
}

function mdcEnd(text: string, start: number, openerLength: number): number {
  let i = start + openerLength
  if (text.startsWith('![', start) || text[start] === '[') {
    i = balanced(text, i - 1, '[', ']')
    if (i < 0)
      return -1
    if (text[i] === '(')
      i = balanced(text, i, '(', ')')
  }
  else {
    while (/[\w-]/.test(text[i] ?? ''))
      i++
    if (text[i] === '[')
      i = balanced(text, i, '[', ']')
  }
  if (i > 0 && text[i] === '{')
    i = balanced(text, i, '{', '}')
  return i
}

function htmlEnd(text: string, start: number, tag: string): number {
  const openEnd = text.indexOf('>', start)
  if (openEnd < 0)
    return -1
  if (VOID_TAGS.has(tag) || text[openEnd - 1] === '/')
    return openEnd + 1
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  re.lastIndex = openEnd + 1
  let depth = 1
  for (let m = re.exec(text); m; m = re.exec(text)) {
    depth += m[1] ? -1 : 1
    if (depth === 0)
      return m.index + m[0].length
  }
  return -1
}
