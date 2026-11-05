import type { TranslationRecord } from '@diglot/core'
import type { ResolvedConfig } from '@diglot/store'
import type { DataStore, Loader, LoaderContext } from 'astro/loaders'
import type { LocaleTarget } from './locales.ts'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply } from '@diglot/mdast'
import { loadConfig, loadLocale } from '@diglot/store'
import { glob } from 'astro/loaders'
import { relative, resolve } from 'pathe'
import { splitFrontmatter } from './frontmatter.ts'
import { isTargetId, translatedId, translatedModulePath } from './ids.ts'
import { resolveLocales } from './locales.ts'
import { getState, setModule } from './state.ts'

type GlobOptions = Parameters<typeof glob>[0]

export type DiglotLoaderOptions = Pick<GlobOptions, 'base' | 'generateId' | 'pattern'>

type Entry = ReturnType<DataStore['values']>[number]

interface TranslationState {
  config: ResolvedConfig
  defaultPath: string
  targets: LocaleTarget[]
  /** Records of each target locale, keyed by hash. */
  records: Map<string, Map<string, TranslationRecord>>
}

const DEBOUNCE_MS = 100
const SOURCE_RE = /\.mdx?$/

/**
 * Loads Markdown and MDX files with Astro's `glob()` loader and adds a translated entry for each
 * source entry and locale of the `i18n` config, built from the records of the translations
 * repository that the `diglot()` integration points at. Entries that already exist in a locale,
 * such as pages translated by hand, are kept as they are.
 */
export function diglotLoader(options: DiglotLoaderOptions): Loader {
  const source = glob(options)
  return {
    name: 'diglot-loader',
    async load(context) {
      const { config, logger, store, watcher } = context
      const translationsRoot = getState().translations
      if (!translationsRoot)
        throw new Error('`diglotLoader()` needs the diglot integration. Add `diglot({ translations })` from `@diglot/astro` to the `integrations` of your Astro config.')
      const cached = new Map(store.entries())
      await source.load(context)

      if (!existsSync(translationsRoot))
        logger.warn(`The translations directory "${translationsRoot}" does not exist.`)
      let state = await loadTranslations(context, translationsRoot)
      const owned = new Map<string, string>()
      const ids = await syncTranslations(context, state, owned, cached)
      logger.info(`Added ${ids.size} translated ${ids.size === 1 ? 'entry' : 'entries'}.`)

      if (!watcher)
        return
      watcher.add(translationsRoot)
      const base = fileURLToPath(new URL(options.base ?? '.', config.root))
      let timer: ReturnType<typeof setTimeout> | undefined
      let reload = false
      let queue = Promise.resolve()
      const schedule = (path: string) => {
        if (isInside(translationsRoot, path))
          reload = true
        else if (!isInside(base, path) || !SOURCE_RE.test(path))
          return
        clearTimeout(timer)
        timer = setTimeout(() => {
          const reloading = reload
          reload = false
          queue = queue.then(async () => {
            if (reloading)
              state = await loadTranslations(context, translationsRoot)
            await syncTranslations(context, state, owned)
            logger.info('Reloaded translations.')
          }).catch((error: Error) => logger.error(`Failed to reload translations: ${error.message}`))
        }, DEBOUNCE_MS)
      }
      watcher.on('add', schedule)
      watcher.on('change', schedule)
      watcher.on('unlink', schedule)
    },
  }
}

async function loadTranslations({ config, logger }: LoaderContext, root: string): Promise<TranslationState> {
  if (!config.i18n)
    throw new Error('`diglotLoader()` reads your locales from the `i18n` option of your Astro config. Add `i18n` with a `defaultLocale` and `locales`.')
  const diglot = await loadConfig(root)
  // Astro reads Markdown without MDC, with either processor. MDX files are always read as MDX.
  if (diglot.parser !== 'satteri')
    logger.warn(`\`diglot.config.ts\` extracts Markdown with the \`${diglot.parser}\` parser, which reads MDC. Astro doesn't read MDC, so unless your Markdown uses it, set \`parser: 'satteri'\` and extract again.`)
  const { defaultPath, targets, unmatched } = resolveLocales(config.i18n, diglot.locales)
  if (unmatched.length)
    logger.info(`No translations for ${unmatched.map(path => `"${path}"`).join(', ')}, because \`diglot.config.ts\` does not list ${unmatched.length === 1 ? 'that locale' : 'those locales'}.`)
  const records = new Map(await Promise.all(targets.map(async ({ locale }) => [locale, await loadLocale(root, locale)] as const)))
  return { config: diglot, defaultPath, targets, records }
}

/**
 * Sets a translated entry for every source entry and target locale with at least one applied
 * translation, and deletes the translated entries it set before that are no longer produced.
 * A Markdown entry is rendered here, while an MDX entry is deferred to its virtual module.
 * `owned` maps the id of each translated entry to its file path in the store. `cached` holds the
 * entries of the previous build, which the first sync reuses when their digest matches.
 * Returns the ids of the translated entries.
 */
async function syncTranslations(context: LoaderContext, state: TranslationState, owned: Map<string, string>, cached?: Map<string, Entry>): Promise<Set<string>> {
  const { config, generateDigest, parseData, renderMarkdown, store } = context
  const { config: diglot, defaultPath, records, targets } = state
  const projectRoot = fileURLToPath(config.root)
  const parser = diglot.parser === 'satteri' ? 'satteri' : 'remark'
  const targetPaths = targets.map(t => t.path)
  const produced = new Set<string>()
  const sources = store.values().filter(entry => entry.filePath && SOURCE_RE.test(entry.filePath) && !isTargetId(entry.id, targetPaths))
  for (const entry of sources) {
    const relativePath = entry.filePath!
    const filePath = resolve(projectRoot, relativePath)
    const mdx = relativePath.endsWith('.mdx')
    const markdown = await readFile(filePath, 'utf8')
    for (const { path, locale } of targets) {
      const id = translatedId(entry.id, defaultPath, path)
      const modulePath = mdx ? translatedModulePath(filePath, path) : filePath
      const storedPath = relative(projectRoot, modulePath)
      const existing = store.get(id)
      if (existing && existing.filePath !== storedPath)
        continue
      const { markdown: translated, report } = await apply(markdown, records.get(locale)!, { file: relativePath, parser, policy: diglot.policy })
      const frontmatter = report.applied ? splitFrontmatter(translated) : undefined
      if (!frontmatter)
        continue
      produced.add(id)
      owned.set(id, storedPath)
      if (mdx)
        setModule(modulePath, translated)
      const digest = generateDigest(translated)
      if (existing?.digest === digest)
        continue
      const previous = cached?.get(id)
      if (previous?.digest === digest && previous.filePath === storedPath) {
        store.set(previous)
        continue
      }
      const data = await parseData({ id, data: frontmatter.data, filePath })
      if (mdx) {
        store.set({ id, data, body: frontmatter.body, filePath: storedPath, digest, deferredRender: true })
        continue
      }
      const rendered = await renderMarkdown(translated, { fileURL: pathToFileURL(filePath) })
      store.set({ id, data, body: frontmatter.body, filePath: storedPath, digest, rendered, assetImports: rendered.metadata?.imagePaths })
    }
  }
  for (const [id, storedPath] of owned) {
    if (produced.has(id))
      continue
    if (store.get(id)?.filePath === storedPath)
      store.delete(id)
    owned.delete(id)
  }
  return produced
}

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return !rel.startsWith('..') && !rel.startsWith('/')
}
