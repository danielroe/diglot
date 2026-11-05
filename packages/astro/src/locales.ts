import type { AstroConfig } from 'astro'

/** A locale that receives translated entries. */
export interface LocaleTarget {
  /** Directory of the locale in the collection, and the first segment of its entry ids. */
  path: string
  /** Locale of the translation records, as listed in `diglot.config.ts`. */
  locale: string
}

export interface ResolvedLocales {
  /** Path of Astro's default locale, which holds the source entries. */
  defaultPath: string
  targets: LocaleTarget[]
  /** Paths of every Astro locale other than the default, with or without a matching diglot locale. */
  localePaths: string[]
  /** Paths of Astro locales without a matching diglot locale. */
  unmatched: string[]
}

/**
 * Matches the locales of Astro's `i18n` config with the locales of a translations repository.
 * A diglot locale matches when it equals the path or one of the codes of an Astro locale,
 * ignoring case, so `pt-br` in Astro matches `pt-BR` in diglot.
 */
export function resolveLocales(i18n: NonNullable<AstroConfig['i18n']>, locales: string[]): ResolvedLocales {
  const targets: LocaleTarget[] = []
  const unmatched: string[] = []
  const localePaths: string[] = []
  for (const entry of i18n.locales) {
    const path = typeof entry === 'string' ? entry : entry.path
    if (path === i18n.defaultLocale)
      continue
    localePaths.push(path)
    const names = new Set([path, ...(typeof entry === 'string' ? [] : entry.codes)].map(name => name.toLowerCase()))
    const locale = locales.find(l => names.has(l.toLowerCase()))
    if (locale)
      targets.push({ path, locale })
    else
      unmatched.push(path)
  }
  return { defaultPath: i18n.defaultLocale, targets, localePaths, unmatched }
}
