import type { Glossary, GlossaryEntry, LocaleStyle, Placeholder } from '@diglot/core'
import type { MtSegment, QaCheck, QaIssue } from './types.ts'
import { lengthRatio, matchGlossary, termPattern, validate } from '@diglot/core'

export interface QaOptions {
  locale: string
  glossary?: Glossary
  style?: LocaleStyle
}

const PLACEHOLDER = /(?<!\\)\{\/?\d+\}/g
const PLACEHOLDER_LIKE = /[｛{]\s*\d+\s*[｝}]|［\s*\d+\s*］|\[\s*\d+\s*\](?!\()|<\d+\s*\/?>|\$\d+\b|%\d+\$?s?/g

const RATIO_BANDS: Record<string, [number, number]> = {
  fr: [0.85, 1.7],
  de: [0.85, 1.8],
  es: [0.85, 1.7],
  it: [0.85, 1.7],
  pt: [0.85, 1.7],
  ru: [0.8, 1.7],
  ja: [0.25, 0.9],
  zh: [0.2, 0.8],
  ko: [0.3, 1],
}

const LEAK = /\b(?:translat(?:ion|ed?)|placeholder|segment|here is|note:)|traduction|tradui|voici la|翻訳|プレースホルダー|```|"id"\s*:|<\/?context>|\bid\s*[:=]\s*"?s\d+/i

/**
 * Model-free checks of a translated skeleton against its source segment. `validate` from
 * `@diglot/core` is the grammar gate; the other checks catch output that is valid but
 * suspicious (untranslated, truncated, leaked instructions, changed numbers, emphasis that
 * would not parse).
 */
export function runQa(translation: string, segment: MtSegment, options: QaOptions): QaIssue[] {
  return [
    ...checkGrammar(translation, segment),
    ...checkPlaceholderLike(translation, segment.skeleton),
    ...checkUntranslated(translation, segment.skeleton, options.glossary),
    ...checkLengthRatio(translation, segment.skeleton, options.locale, options.style),
    ...checkLeakedInstructions(translation, segment.skeleton),
    ...checkStructure(translation, segment),
    ...checkNumbers(translation, segment.skeleton),
    ...(segment.format === 'plain' ? [] : checkEmphasis(translation, segment)),
    ...checkGlossary(translation, segment.skeleton, options.glossary),
  ]
}

/** True when any issue has `error` severity. */
export function hasErrors(issues: QaIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error')
}

function issue(check: QaCheck, severity: QaIssue['severity'], message: string): QaIssue {
  return { check, severity, message }
}

function checkGrammar(translation: string, segment: MtSegment): QaIssue[] {
  const result = validate(translation, segment)
  return [
    ...result.errors.map(e => issue(e.code.includes('placeholder') || e.code === 'not-paired' ? 'placeholders' : 'grammar', 'error', e.message)),
    ...result.warnings.map(e => issue(e.code.includes('placeholder') ? 'placeholders' : 'grammar', 'warning', e.message)),
  ]
}

function checkPlaceholderLike(translation: string, source: string): QaIssue[] {
  const count = (s: string) => s.replace(PLACEHOLDER, ' ').match(PLACEHOLDER_LIKE) ?? []
  const allowed = count(source).length
  const found = count(translation)
  return found.length > allowed ? [issue('placeholders', 'error', `placeholder-like text ${JSON.stringify(found[0])}`)] : []
}

function words(skeleton: string, glossary?: Glossary): string[] {
  let text = skeleton.replace(PLACEHOLDER, ' ')
  for (const entry of glossary?.terms ?? []) {
    if (entry.decision === 'translate')
      continue
    const pattern = termPattern(entry)
    text = text.replace(new RegExp(pattern.source, `${pattern.flags}g`), ' ')
  }
  return text.match(/\p{L}{2,}/gu) ?? []
}

function checkUntranslated(translation: string, source: string, glossary?: Glossary): QaIssue[] {
  const sourceWords = words(source, glossary)
  if (sourceWords.length < 3)
    return []
  if (source.trim() === translation.trim())
    return [issue('untranslated', 'error', 'translation is identical to the source')]
  const known = new Set(sourceWords.map(w => w.toLowerCase()))
  const target = words(translation, glossary).map(w => w.toLowerCase())
  if (target.length >= 4 && target.filter(w => known.has(w)).length / target.length > 0.6)
    return [issue('untranslated', 'warning', 'mostly source-language words')]
  return []
}

function checkLengthRatio(translation: string, source: string, locale: string, style?: LocaleStyle): QaIssue[] {
  const band = style?.lengthRatio ?? RATIO_BANDS[locale.split('-')[0]!.toLowerCase()]
  if (!band || [...source.replace(PLACEHOLDER, '')].length < 25)
    return []
  const ratio = lengthRatio(translation, source)
  const [min, max] = band
  return ratio < min || ratio > max ? [issue('length-ratio', 'warning', `length ratio ${ratio.toFixed(2)} outside [${min}, ${max}]`)] : []
}

function checkLeakedInstructions(translation: string, source: string): QaIssue[] {
  const match = LEAK.exec(translation)
  return match && !LEAK.test(source) ? [issue('leaked-instructions', 'error', `unexpected ${JSON.stringify(match[0])}`)] : []
}

function checkStructure(translation: string, segment: MtSegment): QaIssue[] {
  if (segment.kind === 'heading' && /^\s*#/.test(translation))
    return [issue('structure', 'error', 'heading level markers in a heading segment')]
  const lines = (s: string) => s.split('\n').length
  if (lines(translation) !== lines(segment.skeleton))
    return [issue('structure', 'warning', `line count ${lines(segment.skeleton)} -> ${lines(translation)}`)]
  return []
}

function checkNumbers(translation: string, source: string): QaIssue[] {
  const strip = (s: string) => s.replace(PLACEHOLDER, ' ')
  const target = strip(translation)
  const missing = (strip(source).match(/\bv?\d+(?:\.\d+)*\b/g) ?? []).filter(n => !target.includes(n))
  const versions = missing.filter(n => /[v.]|\d\d/.test(n))
  const digits = missing.filter(n => !versions.includes(n))
  return [
    ...(versions.length ? [issue('numbers', 'error', `missing ${versions.join(', ')}`)] : []),
    ...(digits.length ? [issue('numbers', 'warning', `missing ${digits.join(', ')}`)] : []),
  ]
}

interface Unit {
  type: 'char' | 'marker' | 'placeholder'
  value: string
  at: number
}

function units(skeleton: string, placeholders: Placeholder[]): Unit[] {
  const out: Unit[] = []
  const re = /\\([\s\S])|(?<ph>\{(\/?)(\d+)\})|(\*\*|__|~~|\*|_)/gy
  let i = 0
  while (i < skeleton.length) {
    re.lastIndex = i
    const m = re.exec(skeleton)
    if (!m) {
      out.push({ type: 'char', value: skeleton[i]!, at: i })
      i++
      continue
    }
    if (m[1] !== undefined) {
      out.push({ type: 'char', value: m[1], at: i })
    }
    else if (m.groups?.ph) {
      const placeholder = placeholders[Number(m[4])]
      const rendered = m[3] ? placeholder?.close : placeholder?.source
      out.push({ type: 'placeholder', value: rendered || 'x', at: i })
    }
    else {
      out.push({ type: 'marker', value: m[5]!, at: i })
    }
    i += m[0].length
  }
  return out
}

const isSpace = (ch: string) => ch === '' || /\s/u.test(ch)
const isPunct = (ch: string) => /[\p{P}\p{S}]/u.test(ch)

function misplacedMarkers(skeleton: string, placeholders: Placeholder[]): Array<{ marker: string, at: number, role: 'open' | 'close' }> {
  const list = units(skeleton, placeholders)
  const edge = (from: number, step: 1 | -1) => {
    let k = from
    while (list[k]?.type === 'marker' && list[k]!.value[0] === list[from]!.value[0]) k += step
    const unit = list[k]
    if (!unit)
      return ''
    return step === 1 ? unit.value[0]! : unit.value.at(-1)!
  }
  const stack: Array<{ marker: string, at: number, canOpen: boolean }> = []
  const out: Array<{ marker: string, at: number, role: 'open' | 'close' }> = []
  list.forEach((unit, k) => {
    if (unit.type !== 'marker')
      return
    const prev = edge(k, -1)
    const next = edge(k, 1)
    const left = !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev))
    const right = !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next))
    const underscore = unit.value[0] === '_'
    const canOpen = underscore ? left && (!right || isPunct(prev)) : left
    const canClose = underscore ? right && (!left || isPunct(next)) : right
    if (stack.at(-1)?.marker === unit.value) {
      const opener = stack.pop()!
      if (!opener.canOpen)
        out.push({ marker: opener.marker, at: opener.at, role: 'open' })
      if (!canClose)
        out.push({ marker: unit.value, at: unit.at, role: 'close' })
    }
    else {
      stack.push({ marker: unit.value, at: unit.at, canOpen })
    }
  })
  return out
}

function checkEmphasis(translation: string, segment: Pick<MtSegment, 'skeleton' | 'placeholders'>): QaIssue[] {
  const found = misplacedMarkers(translation, segment.placeholders)
  if (!found.length)
    return []
  const severity = misplacedMarkers(segment.skeleton, segment.placeholders).length ? 'warning' : 'error'
  return found.map(f => issue('emphasis', severity, `"${f.marker}" at ${f.at} cannot ${f.role} emphasis here; use "*" and keep markers next to spaces or the words they wrap`))
}

function keptPattern(entry: GlossaryEntry): RegExp {
  if (entry.match)
    return termPattern(entry)
  return new RegExp(`\\b${entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?\\b`, entry.caseSensitive ? 'u' : 'iu')
}

function checkGlossary(translation: string, source: string, glossary?: Glossary): QaIssue[] {
  if (!glossary)
    return []
  const issues: QaIssue[] = []
  for (const entry of matchGlossary(glossary, source)) {
    if (entry.decision === 'translate') {
      if (!entry.target)
        continue
      const accepted = [entry.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ...(entry.accept ?? [])]
      if (!accepted.some(p => new RegExp(p, 'iu').test(translation)))
        issues.push(issue('glossary', 'warning', `"${entry.term}" should be translated as "${entry.target}"`))
    }
    else if (!keptPattern(entry).test(translation)) {
      issues.push(issue('glossary', 'warning', `"${entry.term}" should stay untranslated`))
    }
  }
  return issues
}
