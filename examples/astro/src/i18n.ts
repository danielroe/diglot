import type { CollectionEntry } from 'astro:content'
import { getRelativeLocaleUrl } from 'astro:i18n'

export const LOCALES = { en: 'English', de: 'Deutsch', ja: '日本語' } as const

export type Locale = keyof typeof LOCALES

/** The strings of the layout, which aren't part of any page. */
const UI: Record<Locale, { pages: string, languages: string, footer: string }> = {
  en: { pages: 'Pages', languages: 'Languages', footer: 'Translated with diglot' },
  de: { pages: 'Seiten', languages: 'Sprachen', footer: 'Übersetzt mit diglot' },
  ja: { pages: 'ページ', languages: '言語', footer: 'diglot で翻訳' },
}

/** The order of the pages in the navigation, by page key. */
const ORDER = ['', 'guide', 'components', 'about']

interface Page {
  entry: CollectionEntry<'docs'>
  locale: Locale
  key: string
}

/** The locale of an entry and its page key, the id without the locale: `de/guide` is `guide` in `de`. */
export function parseEntry(entry: CollectionEntry<'docs'>): Page {
  const [first, ...rest] = entry.id.split('/')
  if (first === 'de' || first === 'ja')
    return { entry, locale: first, key: rest.join('/') }
  return { entry, locale: 'en', key: entry.id === 'index' ? '' : entry.id }
}

/** The URL of a page in a locale, without a prefix for the default locale. */
export function getPageUrl({ locale, key }: Pick<Page, 'key' | 'locale'>): string {
  return getRelativeLocaleUrl(locale, key)
}

/** The pages of a locale, in navigation order. Untranslated pages have no entry in a locale. */
export function getNavigation(entries: CollectionEntry<'docs'>[], locale: Locale): Page[] {
  return entries.map(parseEntry).filter(page => page.locale === locale).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
}

/** The versions of a page that exist, in the order of `LOCALES`. */
export function getLanguages(entries: CollectionEntry<'docs'>[], key: string): Page[] {
  const order = Object.keys(LOCALES)
  return entries.map(parseEntry).filter(page => page.key === key).sort((a, b) => order.indexOf(a.locale) - order.indexOf(b.locale))
}

export function getUi(locale: Locale): (typeof UI)[Locale] {
  return UI[locale]
}
