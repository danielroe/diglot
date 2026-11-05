/**
 * Returns the id of an entry in another locale. Source entries live either in the directory
 * of the default locale (`en/guide`) or at the root of the collection (`guide`), and the
 * translated entry lives in the directory of the target locale (`fr/guide`). An index page
 * (`en` or `index`) becomes the locale itself (`fr`), as Astro's default ids do.
 */
export function translatedId(id: string, defaultPath: string, targetPath: string): string {
  if (id === defaultPath || id === 'index')
    return targetPath
  if (id.startsWith(`${defaultPath}/`))
    return `${targetPath}${id.slice(defaultPath.length)}`
  return `${targetPath}/${id}`
}

/** Whether an entry id belongs to one of the target locales instead of the source. */
export function isTargetId(id: string, targetPaths: string[]): boolean {
  return targetPaths.some(path => id === path || id.startsWith(`${path}/`))
}

const TRANSLATED_MODULE_RE = /\.diglot-[\w-]+\.mdx$/

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
