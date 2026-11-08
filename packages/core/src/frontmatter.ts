import type { Policy } from './policy.ts'
import type { InlineNode } from './types.ts'

export type ValuePath = Array<string | number>

const HTML_TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-z][\w-]*)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi

/**
 * The frontmatter strings that `policy` extracts, as `[path, content]`. Values at the
 * `htmlFrontmatter` paths of `policy` are split by `htmlInline`.
 */
export function frontmatterValues(data: unknown, policy: Pick<Policy, 'frontmatter' | 'htmlFrontmatter'>): Array<[ValuePath, string | InlineNode[]]> {
  const html = new Set(Array.from(stringsAtPaths(data, policy.htmlFrontmatter), ([path]) => JSON.stringify(path)))
  return Array.from(stringsAtPaths(data, policy.frontmatter), ([path, value]) => [path, html.has(JSON.stringify(path)) ? htmlInline(value) : value])
}

/**
 * Splits an HTML string into text and placeholders. A link becomes a paired placeholder around
 * its text, any other element with its content and any lone tag or comment becomes one
 * placeholder.
 */
export function htmlInline(html: string): InlineNode[] {
  const out: InlineNode[] = []
  const tags = [...html.matchAll(HTML_TAG_RE)]
  let last = 0
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!
    const [source, closing, tagName] = tag
    const name = tagName?.toLowerCase()
    const start = tag.index
    let end = start + source.length
    let node: InlineNode = { type: 'atomic', kind: 'html', source, ...(name ? { name } : {}) }
    const close = name && !closing && !source.endsWith('/>') ? closingTag(tags, i, name) : -1
    if (close >= 0) {
      const closeTag = tags[close]!
      const inner = html.slice(end, closeTag.index)
      end = closeTag.index + closeTag[0].length
      node = name === 'a'
        ? { type: 'link', open: source, close: closeTag[0], children: htmlInline(inner) }
        : { type: 'atomic', kind: 'html', name: name!, source: html.slice(start, end), ...(/\p{L}/u.test(inner.replace(HTML_TAG_RE, '')) ? { hidesText: true } : {}) }
      i = close
    }
    if (start > last)
      out.push({ type: 'text', value: html.slice(last, start) })
    out.push(node)
    last = end
  }
  if (last < html.length)
    out.push({ type: 'text', value: html.slice(last) })
  return out
}

function closingTag(tags: RegExpExecArray[], open: number, name: string): number {
  let depth = 0
  for (let i = open + 1; i < tags.length; i++) {
    const [source, closing, other] = tags[i]!
    if (other?.toLowerCase() !== name || source.endsWith('/>'))
      continue
    if (!closing)
      depth++
    else if (depth-- === 0)
      return i
  }
  return -1
}

/**
 * Yields `[path, value]` for every non-empty string at the given dotted paths. `key[]` walks
 * array items. A literal dotted key (`{ 'navigation.title': ... }`) is read before the nested
 * path (`{ navigation: { title: ... } }`), and `path` names the key that was read.
 */
export function* stringsAtPaths(data: unknown, paths: string[]): Generator<[ValuePath, string]> {
  const found: Array<[ValuePath, string]> = []
  for (const path of paths)
    collect(data, path.split('.'), [], found)
  yield* found
}

function collect(value: unknown, parts: string[], path: ValuePath, found: Array<[ValuePath, string]>): void {
  if (!parts.length) {
    if (typeof value === 'string' && value.trim())
      found.push([path, value])
    return
  }
  if (!value || typeof value !== 'object')
    return
  const record = value as Record<string, unknown>
  for (let n = parts.length; n > 1; n--) {
    const key = parts.slice(0, n).join('.')
    if (key.includes('[]') || !Object.hasOwn(record, key))
      continue
    const before = found.length
    collect(record[key], parts.slice(n), [...path, key], found)
    if (found.length > before)
      return
  }
  const head = parts[0]!
  const rest = parts.slice(1)
  if (head.endsWith('[]')) {
    const key = head.slice(0, -2)
    const items = record[key]
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++)
        collect(items[i], rest, [...path, key, i], found)
    }
    return
  }
  collect(record[head], rest, [...path, head], found)
}

/**
 * The span to replace when swapping the YAML scalar at `start`..`end` (a `yaml` node range) in
 * `source` for a flow scalar. A block scalar's trailing line break stays outside the span, and
 * the comment on its header line is returned as `suffix` to append to the replacement.
 */
export function yamlScalarSpan(source: string, start: number, end: number): { start: number, end: number, suffix: string } {
  while (end > start && (source[end - 1] === '\n' || source[end - 1] === '\r'))
    end--
  const header = /[|>][1-9+-]*[ \t]+(#[^\r\n]*)/y
  header.lastIndex = start
  const comment = header.exec(source)?.[1]
  return { start, end, suffix: comment ? ` ${comment}` : '' }
}

/** Sets the value at `path`, which must exist. */
export function setAtPath(data: unknown, path: ValuePath, value: unknown): void {
  let cursor = data as Record<string | number, unknown>
  for (const key of path.slice(0, -1))
    cursor = cursor[key] as Record<string | number, unknown>
  cursor[path.at(-1)!] = value
}
