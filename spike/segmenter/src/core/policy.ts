import type { SegmentKind } from './types.ts'

/** Component props whose string values are prose. Anything not listed is not translated. */
export const PROSE_PROPS: Record<string, string[]> = {
  'read-more': ['title'],
  'card': ['title', 'description'],
  'video-accordion': ['title'],
  'link-example': ['title'],
  'u-button': ['label'],
  'collapsible': ['name'],
}

/** Containers that only lay out their children; paragraphs inside them are ordinary paragraphs. */
export const LAYOUT_CONTAINERS = new Set(['steps', 'card-group', 'code-group'])

export const HTML_TEXT_CONTAINERS = new Set(['summary', 'div', 'details', 'figcaption', 'dt', 'dd'])

export function kindForContainers(containers: string[]): SegmentKind {
  const parent = containers.findLast(c => !LAYOUT_CONTAINERS.has(c))
  if (!parent) return 'paragraph'
  if (parent === 'li') return 'list-item'
  if (parent === 'blockquote') return 'blockquote'
  if (HTML_TEXT_CONTAINERS.has(parent)) return 'html-block'
  return 'component-slot'
}

/** Code block filenames that read as prose (`Directory Structure`, `Before`) rather than paths. */
export function isProseCodeLabel(label: string): boolean {
  return /^(?=.*\s|[A-Z])[^./\\[\]~]+$/.test(label) && !/^(?:npm|yarn|pnpm|bun|deno)$/.test(label)
}

const SHELL_LIKE = new Set(['bash', 'sh', 'shell', 'yaml', 'yml', 'ini', 'toml', 'dotenv', 'python'])

/** A code comment with at least two words of prose (skips twoslash `// ^?` / `// @errors` directives). */
export function isProseComment(line: string, language: string): boolean {
  const l = line.trim()
  if (/^\/\/\s*(?:\^\?|\^\||@|---)/.test(l)) return false
  const comment = /^(?:\/\/|\/\*|\*\s|<!--)/.test(l) || /\s\/\/\s/.test(line) || (SHELL_LIKE.has(language) && l.startsWith('#'))
  return comment && /[a-z]{3,}\s+[a-z]{2,}/i.test(l)
}

/** Placeholder source used for hard breaks by every adapter. */
export const BREAK_SOURCE = ' :br '
