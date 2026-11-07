import type { DiglotLoaderOptions, TranslatedEntry } from '@diglot/astro'
import type { Loader } from 'astro/loaders'
import type { StarlightSettings } from './state.ts'
import { fileURLToPath } from 'node:url'
import { diglotLoader } from '@diglot/astro'
import { resolve } from 'pathe'
import { getSettings } from './state.ts'

export type DiglotDocsLoaderOptions = Pick<DiglotLoaderOptions, 'generateId'>

/** The file extensions of Starlight's `docsLoader()`. */
const DOCS_EXTENSIONS = ['markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'md', 'mdx']

/**
 * Loads the `docs` collection like Starlight's `docsLoader()`, and adds the translated pages of
 * the diglot plugin. A translated page links to its source page for editing, and with
 * `lastUpdated`, its date is the newest update of its translations.
 */
export function diglotDocsLoader(options: DiglotDocsLoaderOptions = {}): Loader {
  let loader: Loader | undefined
  return {
    name: 'diglot-docs-loader',
    load(context) {
      const { config } = context
      const root = resolve(fileURLToPath(config.root))
      if (!getSettings().has(root))
        throw new Error('`diglotDocsLoader()` needs the diglot plugin. Add `diglot({ translations })` from `@diglot/starlight` to the `plugins` of your Starlight config.')
      const extensions = config.integrations.some(({ name }) => name === '@astrojs/markdoc') ? [...DOCS_EXTENSIONS, 'mdoc'] : DOCS_EXTENSIONS
      loader ??= diglotLoader({
        ...options,
        base: new URL('content/docs/', config.srcDir),
        pattern: `**/[^_]*.{${extensions.join(',')}}`,
        data: entry => entryData(entry, getSettings().get(root)!),
      })
      return loader.load(context)
    },
  }
}

/**
 * The edit link and the last updated date of a translated page. Frontmatter values other than
 * `true` are kept. Starlight resolves `true` from the file of the entry, which is the source page,
 * or for MDX a file that doesn't exist.
 */
function entryData({ frontmatter, source, updatedAt }: TranslatedEntry, { editLinkBaseUrl, lastUpdated }: StarlightSettings): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (editLinkBaseUrl && (frontmatter.editUrl ?? true) === true)
    data.editUrl = `${editLinkBaseUrl.replace(/\/?$/, '/')}${source}`
  if ((frontmatter.lastUpdated ?? lastUpdated) === true)
    data.lastUpdated = updatedAt
  return data
}
