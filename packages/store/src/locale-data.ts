import type { Glossary, GlossaryEntry, LocaleState, LocaleStyle } from '@diglot/core'
import type { StoreArchive } from './archive.ts'
import { parse as parseYaml } from 'yaml'

/** A glossary entry in x18n's shape: one term with a translation per locale. */
export interface X18nGlossaryEntry {
  term: string
  translations?: Record<string, string>
  note?: string
  doNotTranslate?: boolean
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

/**
 * Merges a shared glossary below a locale's own: entries of `own` replace shared entries with
 * the same term (case-insensitively), and the style rules are those of `own`. Returns
 * `undefined` when both are.
 */
export function mergeGlossary(shared: Glossary | undefined, own: Glossary | undefined): Glossary | undefined {
  if (!shared && !own)
    return
  const local = own ?? { terms: [] }
  const overridden = new Set(local.terms.map(t => t.term.toLowerCase()))
  return {
    terms: [...(shared?.terms ?? []).filter(t => !overridden.has(t.term.toLowerCase())), ...local.terms],
    ...(local.style ? { style: local.style } : {}),
  }
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

function mapping(data: unknown, file: string): Record<string, unknown> {
  if (data === undefined || data === null)
    return {}
  if (typeof data !== 'object' || Array.isArray(data))
    throw new Error(`${file}: must be a mapping`)
  return data as Record<string, unknown>
}

/** Checks the parsed YAML of a `<locale>/locale.yml`. Throws on a malformed state. */
export function parseLocaleState(data: unknown, file = 'locale.yml'): LocaleState {
  const state = mapping(data, file) as LocaleState
  if (state.mt !== undefined && (!state.mt || typeof state.mt !== 'object' || (state.mt.enabled !== undefined && typeof state.mt.enabled !== 'boolean')))
    throw new Error(`${file}: \`mt.enabled\` must be a boolean`)
  const governance = state.governance
  if (governance !== undefined) {
    if (!governance || typeof governance !== 'object')
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

/** Checks the parsed YAML of a `<locale>/style.yml`. Throws on a malformed style. */
export function parseStyle(data: unknown, file = 'style.yml'): LocaleStyle {
  const style = mapping(data, file) as LocaleStyle
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

/** The YAML files of a store by path, as in `StoreArchive.files`. */
type StoreFiles = Pick<StoreArchive, 'files'>

export interface ArchiveGlossaryOptions {
  /** Path of the glossary shared by every locale. Defaults to `glossary.yml`; `false` reads none. */
  shared?: string | false
}

function readYaml(store: StoreFiles, path: string): unknown {
  const text = store.files.get(path)
  return text === undefined ? undefined : parseYaml(text) ?? null
}

/**
 * The glossary of a locale in the files of an archive: the shared glossary, overridden term by
 * term by `<locale>/glossary.yml`. Returns `undefined` when neither exists. Throws on a
 * malformed glossary.
 */
export function archiveGlossary(store: StoreFiles, locale: string, options: ArchiveGlossaryOptions = {}): Glossary | undefined {
  const sharedPath = options.shared ?? 'glossary.yml'
  const shared = sharedPath === false ? undefined : readYaml(store, sharedPath)
  const own = readYaml(store, `${locale}/glossary.yml`)
  return mergeGlossary(
    shared === undefined ? undefined : parseGlossary(shared, locale, sharedPath || undefined),
    own === undefined ? undefined : parseGlossary(own, locale, `${locale}/glossary.yml`),
  )
}

/** The `<locale>/locale.yml` of a locale in the files of an archive, or an empty state. Throws on a malformed state. */
export function archiveLocaleState(store: StoreFiles, locale: string): LocaleState {
  return parseLocaleState(readYaml(store, `${locale}/locale.yml`), `${locale}/locale.yml`)
}

/** The `<locale>/style.yml` of a locale in the files of an archive, or `undefined`. Throws on a malformed style. */
export function archiveStyle(store: StoreFiles, locale: string): LocaleStyle | undefined {
  const data = readYaml(store, `${locale}/style.yml`)
  return data === undefined ? undefined : parseStyle(data, `${locale}/style.yml`)
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string')
}
