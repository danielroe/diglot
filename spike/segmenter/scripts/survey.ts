import { writeFileSync } from 'node:fs'
import type { Node } from 'comark'
import { children, isElement, parse } from '../src/adapters/comark.ts'
import { PROSE_PROPS } from '../src/core/policy.ts'
import { extractNavigation } from '../src/adapters/navigation.ts'
import { isPlaceholderOnly } from '../src/core/skeleton.ts'
import type { Segment } from '../src/core/types.ts'
import { MODULE_REPOS, NUXT_BRANCHES, segmentSource } from '../src/corpus.ts'
import { readTree } from '../src/git.ts'

const STANDARD = new Set(['p', 'a', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'img', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'template'])
const INLINE_PARENTS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'a', 'strong', 'em', 'del'])
const NON_PROSE_VALUE = /^(?:i-|\/|#|https?:|_blank|\\_blank|\d|true|false|[\w-]+$)/

const components = new Map<string, { block: number, inline: number, html: number, props: Map<string, { count: number, proseLike: number, examples: Set<string> }> }>()
const frontmatterKeys = new Map<string, number>()
const navigationKeys = new Map<string, number>()

function flatten(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  if (Array.isArray(obj)) return obj.flatMap(v => flatten(v, `${prefix}[]`))
  return [prefix]
}

for (const source of [...NUXT_BRANCHES, ...MODULE_REPOS]) {
  for (const { path, source: text } of readTree(source.ref, 'docs', source.cwd, p => p.endsWith('.md') || p.endsWith('.navigation.yml'))) {
    if (path.endsWith('.yml')) {
      for (const k of extractNavigation(path, text).keys) navigationKeys.set(k, (navigationKeys.get(k) ?? 0) + 1)
      continue
    }
    const doc = await parse(text)
    for (const key of new Set(flatten(doc.frontmatter))) frontmatterKeys.set(key, (frontmatterKeys.get(key) ?? 0) + 1)
    const walk = (node: Node, parent: string) => {
      if (!isElement(node)) return
      const [tag, attrs] = node
      if (!STANDARD.has(tag)) {
        const entry = components.get(tag) ?? { block: 0, inline: 0, html: 0, props: new Map() }
        if (attrs.$?.html) entry.html++
        else if (INLINE_PARENTS.has(parent)) entry.inline++
        else entry.block++
        for (const [key, value] of Object.entries(attrs)) {
          if (key === '$') continue
          const prop = entry.props.get(key) ?? { count: 0, proseLike: 0, examples: new Set() }
          prop.count++
          if (isProseLike(value)) prop.proseLike++
          if (prop.examples.size < 3) prop.examples.add(String(JSON.stringify(value)).slice(0, 70))
          entry.props.set(key, prop)
        }
        components.set(tag, entry)
      }
      for (const c of children(node)) walk(c, tag)
    }
    for (const n of doc.nodes) walk(n, 'root')
  }
}

const segmentsBySource = new Map<string, Segment[]>()
const codeStats = { blocks: 0, withProseComments: 0, lines: 0, commentLines: 0, byLanguage: {} as Record<string, { blocks: number, withComments: number }> }
for (const source of [...NUXT_BRANCHES, ...MODULE_REPOS]) {
  const files = await segmentSource(source)
  segmentsBySource.set(source.name, files.flatMap(f => f.segments))
  if (source.name === 'main') {
    for (const cb of files.flatMap(f => f.codeBlocks)) {
      codeStats.blocks++
      codeStats.lines += cb.lines
      codeStats.commentLines += cb.commentLines
      if (cb.commentLines) codeStats.withProseComments++
      const lang = codeStats.byLanguage[cb.language || '(none)'] ??= { blocks: 0, withComments: 0 }
      lang.blocks++
      if (cb.commentLines) lang.withComments++
    }
  }
}

const main = segmentsBySource.get('main')!
const md = main.filter(s => s.format === 'markdown' || s.placeholders.length)
const bucket = (n: number) => n === 0 ? '0' : n === 1 ? '1' : n === 2 ? '2' : n <= 5 ? '3-5' : '6+'
const placeholderBuckets = countBy(md, s => bucket(s.placeholders.length))
const placeholderTypes = countBy(md.flatMap(s => s.placeholders), p => p.type)
const placeholderOnly = md.filter(s => isPlaceholderOnly(s.skeleton))
const inlineComponents = md.flatMap(s => s.placeholders.filter(p => p.type === 'component' || p.type === 'html').map(p => ({ p, s })))
const inlineComponentNames = countBy(inlineComponents, ({ p }) => `${p.type}:${p.name}${p.hidesText ? ' (hides text)' : ''}`)
const hidden = inlineComponents.filter(({ p }) => p.hidesText)

const report = {
  components: Object.fromEntries([...components].sort((a, b) => (b[1].block + b[1].inline + b[1].html) - (a[1].block + a[1].inline + a[1].html)).map(([tag, c]) => [tag, {
    block: c.block,
    inline: c.inline,
    html: c.html,
    allowlisted: PROSE_PROPS[tag] ?? [],
    props: Object.fromEntries([...c.props].map(([k, p]) => [k, { count: p.count, proseLike: p.proseLike, examples: [...p.examples] }])),
  }])),
  frontmatterKeys: Object.fromEntries([...frontmatterKeys].sort((a, b) => b[1] - a[1])),
  navigationKeys: Object.fromEntries(navigationKeys),
  code: codeStats,
  main: {
    segments: main.length,
    byKind: countBy(main, s => s.kind),
    wordsByKind: sumBy(main, s => s.kind, s => s.words),
    words: main.reduce((n, s) => n + s.words, 0),
    markdownUnits: md.length,
    placeholderBuckets,
    placeholderTypes,
    placeholderOnly: { count: placeholderOnly.length, byKind: countBy(placeholderOnly, s => s.kind), examples: placeholderOnly.slice(0, 8).map(s => s.text.slice(0, 120)) },
    withEscapes: md.filter(s => /\\[^\s]/.test(s.skeleton)).length,
    escapeExamples: md.filter(s => /\\[^\s]/.test(s.skeleton)).slice(0, 6).map(s => s.skeleton.slice(0, 140)),
    longest: [...main].sort((a, b) => b.words - a.words).slice(0, 5).map(s => ({ words: s.words, kind: s.kind, file: s.context.file, placeholders: s.placeholders.length, start: s.skeleton.slice(0, 100) })),
    wordsHistogram: countBy(main, s => s.words <= 5 ? '0-5' : s.words <= 15 ? '6-15' : s.words <= 40 ? '16-40' : s.words <= 80 ? '41-80' : '81+'),
    inlineComponents: { occurrences: inlineComponents.length, segments: new Set(inlineComponents.map(({ s }) => s)).size, byName: inlineComponentNames, hidingText: hidden.length, hiddenExamples: [...new Set(hidden.map(({ p }) => p.source))].slice(0, 12) },
  },
}

writeFileSync(new URL('../out/survey.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

function isProseLike(value: unknown): boolean {
  if (typeof value !== 'string' || NON_PROSE_VALUE.test(value)) return false
  if (/^[a-z0-9:-]+(?:\s+[a-z0-9:/.-]+)+$/.test(value)) return false
  return /\p{L}{2,}\s+\p{L}{2,}/u.test(value) || /^\p{Lu}\p{Ll}+$/u.test(value)
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

function sumBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + value(item)
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
