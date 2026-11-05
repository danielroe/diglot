/**
 * Returns the id of an entry in another locale. Source entries live either in the directory
 * of the default locale (`en/guide`) or at the root of the collection (`guide`), and the
 * translated entry lives in the directory of the target locale (`fr/guide`). An index page
 * (`en` or `index`) becomes the locale itself (`fr`). Like Astro's default ids, the locale
 * segment is lower case, so `pt-BR` gives `pt-br/guide`.
 */
export function translatedId(id: string, defaultPath: string, targetPath: string): string {
  const source = defaultPath.toLowerCase()
  const target = targetPath.toLowerCase()
  const lower = id.toLowerCase()
  if (lower === source || id === 'index')
    return target
  if (lower.startsWith(`${source}/`))
    return `${target}${id.slice(source.length)}`
  return `${target}/${id}`
}

/** Whether an entry id belongs to one of the given locales instead of the source, ignoring case. */
export function isTargetId(id: string, localePaths: string[]): boolean {
  const lower = id.toLowerCase()
  return localePaths.some((path) => {
    const prefix = path.toLowerCase()
    return lower === prefix || lower.startsWith(`${prefix}/`)
  })
}

const TRANSLATED_MODULE_RE = /\.diglot-[^/]+\.mdx$/

/**
 * Returns the path of the virtual file that holds the translation of an MDX file into a locale:
 * `guide.mdx` in `fr` is `guide.diglot-fr.mdx`. It sits next to its source, so that relative
 * imports and images resolve the same way.
 */
export function translatedModulePath(path: string, localePath: string): string {
  return path.replace(/\.mdx$/, `.diglot-${localePath}.mdx`)
}

/** Whether a path, without its query, is the virtual file of a translated MDX document. */
export function isTranslatedModule(path: string): boolean {
  return TRANSLATED_MODULE_RE.test(path)
}
