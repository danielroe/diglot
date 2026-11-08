/** The locales of the app. Pages are written in the first one and translated into the others. */
export const locales = [
  { code: 'en', name: 'English', pages: { index: 'Home', guide: 'Guide', about: 'About' } },
  { code: 'fr', name: 'Français', pages: { index: 'Accueil', guide: 'Guide', about: 'À propos' } },
  { code: 'tr', name: 'Türkçe', pages: { index: 'Ana sayfa', guide: 'Kılavuz', about: 'Hakkında' } },
] as const

export const defaultLocale = 'en'

/** The pages of the app, by slug, in the order of the navigation. */
export const pages = ['index', 'guide', 'about'] as const

/** The name of a page in the navigation of `locale`. */
export function pageName(locale: string, slug: (typeof pages)[number]): string {
  return (locales.find(option => option.code === locale) ?? locales[0]).pages[slug]
}

export function isLocale(code: string | undefined): boolean {
  return locales.some(locale => locale.code === code)
}

export function isPagePath(pathname: string): boolean {
  const [section, slug, ...rest] = pathname.split('/').filter(Boolean)
  return !rest.length && (section === 'picker' || isLocale(section)) && (!slug || (pages as readonly string[]).includes(slug))
}
