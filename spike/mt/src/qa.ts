import { fromMarkdown } from 'mdast-util-from-markdown'
import { PLACEHOLDER_LIKE_RE, PLACEHOLDER_RE, type Token } from './placeholders.ts'
import { GLOSSARY, type Locale } from './glossary.ts'

export type QaCheck =
  | 'placeholders'
  | 'untranslated'
  | 'length-ratio'
  | 'leaked-instructions'
  | 'markdown-structure'
  | 'block-type'
  | 'numbers'
  | 'whitespace'

export interface QaIssue {
  check: QaCheck
  severity: 'error' | 'warn'
  message: string
}

export interface QaInput {
  locale: Locale
  sourceMasked: string
  targetMasked: string
  tokens: Token[]
  source: string
  target: string
}

const REPEATABLE = new Set(['code', 'mustache'])

export function checkPlaceholders (sourceMasked: string, targetMasked: string, tokens: Token[] = []): QaIssue[] {
  const want = [...sourceMasked.matchAll(PLACEHOLDER_RE)].map(m => m[1]!)
  const got = [...targetMasked.matchAll(PLACEHOLDER_RE)].map(m => m[1]!)
  const issues: QaIssue[] = []
  const count = (arr: string[]) => arr.reduce((acc, x) => acc.set(x, (acc.get(x) ?? 0) + 1), new Map<string, number>())
  const w = count(want)
  const g = count(got)
  for (const [id, n] of w) {
    const m = g.get(id) ?? 0
    if (m === 0) { issues.push({ check: 'placeholders', severity: 'error', message: `missing {${id}}` }) }
    else if (m !== n) {
      const repeatable = REPEATABLE.has(tokens[Number(id)]?.kind ?? '')
      issues.push({ check: 'placeholders', severity: repeatable ? 'warn' : 'error', message: `{${id}} appears ${m}x, expected ${n}x` })
    }
  }
  for (const id of g.keys()) {
    if (!w.has(id)) { issues.push({ check: 'placeholders', severity: 'error', message: `invented {${id}}` }) }
  }
  const stripped = targetMasked.replace(PLACEHOLDER_RE, '')
  for (const m of stripped.matchAll(PLACEHOLDER_LIKE_RE)) {
    issues.push({ check: 'placeholders', severity: 'error', message: `placeholder-like text ${JSON.stringify(m[0])}` })
  }
  return issues
}

function translatableWords (masked: string, locale: Locale): string[] {
  let s = masked.replace(PLACEHOLDER_RE, ' ')
  for (const e of GLOSSARY) {
    if (e.locales[locale].decision === 'translate') { continue }
    s = s.replace(new RegExp(e.match.source, e.match.flags.includes('g') ? e.match.flags : e.match.flags + 'g'), ' ')
  }
  return s.match(/\p{L}{2,}/gu) ?? []
}

export function checkUntranslated (sourceMasked: string, targetMasked: string, locale: Locale): QaIssue[] {
  const words = translatableWords(sourceMasked, locale)
  if (words.length < 3) { return [] }
  if (sourceMasked.trim() === targetMasked.trim()) {
    return [{ check: 'untranslated', severity: 'error', message: 'target identical to source' }]
  }
  const src = new Set(words.map(w => w.toLowerCase()))
  const tgt = translatableWords(targetMasked, locale).map(w => w.toLowerCase())
  if (tgt.length >= 4 && tgt.filter(w => src.has(w)).length / tgt.length > 0.6) {
    return [{ check: 'untranslated', severity: 'warn', message: 'mostly English words in target' }]
  }
  return []
}

const RATIO_BANDS: Record<Locale, [number, number]> = { fr: [0.85, 1.7], ja: [0.25, 0.9] }

export function lengthRatio (sourceMasked: string, targetMasked: string): number {
  const len = (s: string) => [...s.replace(PLACEHOLDER_RE, '').replace(/\s+/g, ' ').trim()].length
  return len(targetMasked) / Math.max(1, len(sourceMasked))
}

export function checkLengthRatio (sourceMasked: string, targetMasked: string, locale: Locale): QaIssue[] {
  const len = [...sourceMasked.replace(PLACEHOLDER_RE, '')].length
  if (len < 25) { return [] }
  const r = lengthRatio(sourceMasked, targetMasked)
  const [lo, hi] = RATIO_BANDS[locale]
  if (r < lo || r > hi) { return [{ check: 'length-ratio', severity: 'warn', message: `length ratio ${r.toFixed(2)} outside [${lo}, ${hi}]` }] }
  return []
}

const LEAK_RE = /\b(?:translat(?:e|ion|ed)|placeholder|segment|here is|note:)|traduction|tradui|voici la|翻訳|プレースホルダー|```|"id"\s*:|<\/?context>|\bid\s*[:=]\s*"?s\d+/i

export function checkLeakedInstructions (sourceMasked: string, targetMasked: string): QaIssue[] {
  const m = targetMasked.match(LEAK_RE)
  if (m && !LEAK_RE.test(sourceMasked)) {
    return [{ check: 'leaked-instructions', severity: 'error', message: `suspicious text ${JSON.stringify(m[0])}` }]
  }
  return []
}

type Node = { type: string, depth?: number, ordered?: boolean, children?: Node[] }

function shape (md: string): { block: string, inline: Record<string, number> } {
  const tree = fromMarkdown(md) as Node
  const inline: Record<string, number> = {}
  const walk = (n: Node) => {
    if (!['root', 'text', 'paragraph', 'break', 'inlineCode', 'html'].includes(n.type)) {
      const key = n.type === 'heading' ? `heading${n.depth}` : n.type
      inline[key] = (inline[key] ?? 0) + 1
    }
    n.children?.forEach(walk)
  }
  walk(tree)
  const first = tree.children?.[0]
  const block = (tree.children ?? []).map(c => c.type === 'heading' ? `heading${c.depth}` : c.type).join(',') || (first?.type ?? 'empty')
  return { block, inline }
}

export function checkMarkdown (source: string, target: string): QaIssue[] {
  const a = shape(source)
  const b = shape(target)
  const issues: QaIssue[] = []
  if (a.block !== b.block) {
    issues.push({ check: 'block-type', severity: 'error', message: `block structure ${a.block} -> ${b.block}` })
  }
  const keys = new Set([...Object.keys(a.inline), ...Object.keys(b.inline)])
  const diffs: string[] = []
  for (const k of keys) {
    if ((a.inline[k] ?? 0) !== (b.inline[k] ?? 0)) { diffs.push(`${k} ${a.inline[k] ?? 0}->${b.inline[k] ?? 0}`) }
  }
  if (diffs.length) { issues.push({ check: 'markdown-structure', severity: 'warn', message: diffs.join(', ') }) }
  return issues
}

export function checkNumbers (sourceMasked: string, targetMasked: string): QaIssue[] {
  const strip = (s: string) => s.replace(PLACEHOLDER_RE, ' ')
  const nums = strip(sourceMasked).match(/\bv?\d+(?:\.\d+)*\b/g) ?? []
  const tgt = strip(targetMasked)
  const missing = nums.filter(n => !tgt.includes(n))
  if (missing.length) { return [{ check: 'numbers', severity: 'error', message: `missing numbers ${missing.join(', ')}` }] }
  return []
}

export function checkWhitespace (sourceMasked: string, targetMasked: string): QaIssue[] {
  const issues: QaIssue[] = []
  if (targetMasked !== targetMasked.trim()) { issues.push({ check: 'whitespace', severity: 'warn', message: 'leading/trailing whitespace' }) }
  const nl = (s: string) => (s.match(/\n/g) ?? []).length
  if (nl(sourceMasked) !== nl(targetMasked)) { issues.push({ check: 'whitespace', severity: 'warn', message: `line breaks ${nl(sourceMasked)} -> ${nl(targetMasked)}` }) }
  return issues
}

export function runQa (input: QaInput): QaIssue[] {
  const { sourceMasked: s, targetMasked: t, locale } = input
  return [
    ...checkPlaceholders(s, t, input.tokens),
    ...checkUntranslated(s, t, locale),
    ...checkLengthRatio(s, t, locale),
    ...checkLeakedInstructions(s, t),
    ...checkMarkdown(input.source, input.target),
    ...checkNumbers(s, t),
    ...checkWhitespace(s, t),
  ]
}
