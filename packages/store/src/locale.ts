import type { Glossary, GlossaryEntry, LocaleState, LocaleStyle } from '@diglot/core'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'pathe'
import { parse as parseYaml } from 'yaml'

/** A glossary entry in x18n's shape: one term with a translation per locale. */
export interface X18nGlossaryEntry {
  term: string
  translations?: Record<string, string>
  note?: string
  doNotTranslate?: boolean
}

export interface LoadGlossaryOptions {
  /** Glossary shared by every locale (relative to `root` or absolute), merged below `<locale>/glossary.yml`. */
  shared?: string
}

/**
 * Reads the glossary of a locale: the shared glossary, if any, overridden term by term by
 * `<locale>/glossary.yml`. Returns `undefined` when neither exists.
 */
export async function loadGlossary(root: string, locale: string, options: LoadGlossaryOptions = {}): Promise<Glossary | undefined> {
  const sharedPath = options.shared && (isAbsolute(options.shared) ? options.shared : join(root, options.shared))
  const shared = sharedPath ? await readData(sharedPath) : undefined
  const own = await readData(join(root, locale, 'glossary.yml'))
  if (shared === undefined && own === undefined)
    return
  const base = shared === undefined ? { terms: [] } : parseGlossary(shared, locale, options.shared)
  const local = own === undefined ? { terms: [] } : parseGlossary(own, locale, `${locale}/glossary.yml`)
  const overridden = new Set(local.terms.map(t => t.term.toLowerCase()))
  return {
    terms: [...base.terms.filter(t => !overridden.has(t.term.toLowerCase())), ...local.terms],
    ...(local.style ? { style: local.style } : {}),
  }
}

/**
 * Reads the glossary of `locale` from parsed YAML or JSON. Accepts diglot's shape
 * (`{ terms, style }`), x18n's shape (a list of entries, or `{ glossary: [...] }`), and
 * x18n entries inside `terms`.
 */
export function parseGlossary(data: unknown, locale: string, file = 'glossary'): Glossary {
  const object = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined
  const list = Array.isArray(data) ? data : object?.terms ?? object?.glossary ?? []
  if (!Array.isArray(list))
    throw new Error(`${file}: \`terms\` must be a list`)
  const terms = list.map((entry, i) => toEntry(entry, locale, `${file}: term ${i}`))
  const style = object?.style
  if (style !== undefined && !isStrings(style))
    throw new Error(`${file}: \`style\` must be a list of strings`)
  return { terms, ...(style ? { style } : {}) }
}

function toEntry(entry: unknown, locale: string, where: string): GlossaryEntry {
  if (!entry || typeof entry !== 'object' || typeof (entry as GlossaryEntry).term !== 'string')
    throw new Error(`${where} needs a \`term\``)
  const input = entry as Record<string, unknown>
  if (input.decision !== undefined) {
    const ok = input.decision === 'keep'
      || (input.decision === 'translate' && (input.target === undefined || typeof input.target === 'string'))
      || (input.decision === 'keep-gloss' && typeof input.gloss === 'string')
    if (!ok)
      throw new Error(`${where} needs a valid \`decision\``)
    return entry as GlossaryEntry
  }
  const x18n = entry as X18nGlossaryEntry
  const note = typeof x18n.note === 'string' ? { note: x18n.note } : {}
  if (x18n.doNotTranslate)
    return { term: x18n.term, decision: 'keep', ...note }
  const target = translationFor(x18n.translations, locale)
  if (target !== undefined && target.toLowerCase() === x18n.term.toLowerCase())
    return { term: x18n.term, decision: 'keep', ...note }
  return { term: x18n.term, decision: 'translate', ...(target === undefined ? {} : { target }), ...note }
}

function translationFor(translations: Record<string, string> | undefined, locale: string): string | undefined {
  if (!translations)
    return
  if (typeof translations[locale] === 'string')
    return translations[locale]
  const want = locale.toLowerCase().replace(/_/g, '-')
  return Object.entries(translations).find(([key]) => key.toLowerCase().replace(/_/g, '-') === want)?.[1]
}

/** Reads `<locale>/locale.yml`, or an empty state when there is none. */
export async function loadLocaleState(root: string, locale: string): Promise<LocaleState> {
  const data = await readData(join(root, locale, 'locale.yml'))
  if (data === undefined)
    return {}
  const file = `${locale}/locale.yml`
  const state = (data ?? {}) as LocaleState
  if (state.mt !== undefined && (typeof state.mt !== 'object' || (state.mt.enabled !== undefined && typeof state.mt.enabled !== 'boolean')))
    throw new Error(`${file}: \`mt.enabled\` must be a boolean`)
  const governance = state.governance
  if (governance !== undefined) {
    if (typeof governance !== 'object')
      throw new Error(`${file}: \`governance\` must be an object`)
    for (const key of ['approvalRate', 'reviewLatencyDays'] as const) {
      if (governance[key] !== undefined && typeof governance[key] !== 'number')
        throw new Error(`${file}: \`governance.${key}\` must be a number`)
    }
    if (governance.activeReviewers !== undefined && !isStrings(governance.activeReviewers))
      throw new Error(`${file}: \`governance.activeReviewers\` must be a list of strings`)
  }
  return state
}

/** Whether a locale's state enables machine translation. */
export function mtEnabled(state: LocaleState): boolean {
  return state.mt?.enabled === true
}

/** Reads `<locale>/style.yml`, or `undefined` when there is none. */
export async function loadStyle(root: string, locale: string): Promise<LocaleStyle | undefined> {
  const data = await readData(join(root, locale, 'style.yml'))
  if (data === undefined)
    return
  const file = `${locale}/style.yml`
  const style = (data ?? {}) as LocaleStyle
  if (style.rules !== undefined && !isStrings(style.rules))
    throw new Error(`${file}: \`rules\` must be a list of strings`)
  if (style.lengthRatio !== undefined && !(Array.isArray(style.lengthRatio) && style.lengthRatio.length === 2 && style.lengthRatio.every(n => typeof n === 'number')))
    throw new Error(`${file}: \`lengthRatio\` must be a pair of numbers`)
  for (const key of ['spaceBefore', 'spaceAfter'] as const) {
    if (style.typography?.[key] !== undefined && typeof style.typography[key] !== 'string')
      throw new Error(`${file}: \`typography.${key}\` must be a string`)
  }
  return style
}

async function readData(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  if (content === undefined)
    return
  return path.endsWith('.json') ? JSON.parse(content) : parseYaml(content) ?? {}
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string')
}
