import { parse } from 'yaml'

export interface Frontmatter {
  data: Record<string, unknown>
  body: string
}

const FENCE_RE = /^---[ \t]*$/

/**
 * Splits YAML frontmatter from a markdown document. Returns `undefined` for TOML frontmatter
 * (`+++`), which diglot does not translate.
 */
export function splitFrontmatter(markdown: string): Frontmatter | undefined {
  if (markdown.startsWith('+++'))
    return
  const lines = markdown.split('\n')
  if (!FENCE_RE.test(lines[0]!.trimEnd()))
    return { data: {}, body: markdown.trim() }
  const close = lines.findIndex((line, i) => i > 0 && FENCE_RE.test(line.trimEnd()))
  if (close < 0)
    return { data: {}, body: markdown.trim() }
  const data = parse(lines.slice(1, close).join('\n')) as unknown
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {},
    body: lines.slice(close + 1).join('\n').trim(),
  }
}
