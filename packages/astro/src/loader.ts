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
import { deleteModule, getState, setModule } from './state.ts'

type GlobOptions = Parameters<typeof glob>[0]

export interface DiglotLoaderOptions extends Pick<GlobOptions, 'base' | 'generateId' | 'pattern'> {
  /**
   * Returns fields to add to the data of a translated entry, before it is validated against the
   * collection schema. Fields from the translated frontmatter with the same name are replaced.
   */
  data?: (entry: TranslatedEntry) => Record<string, unknown> | undefined
}

/** A translated entry, as `data` receives it. */
export interface TranslatedEntry {
  id: string
  /** Path of the Astro locale, such as `pt-br`. */
  localePath: string
  /** Locale of the records, such as `pt-BR`. */
  locale: string
  /** File path of the source entry, relative to the project root. */
  source: string
  /** The newest `updatedAt` of the records that the page uses. */
  updatedAt: Date
  /** The translated frontmatter of the page, before validation. */
  frontmatter: Record<string, unknown>
}

type Entry = ReturnType<DataStore['values']>[number]
type Watcher = NonNullable<LoaderContext['watcher']>

interface TranslationState {
  config: ResolvedConfig
  defaultPath: string
  targets: LocaleTarget[]
  /** Paths of every non-default Astro locale, whose entries are never sources. */
  localePaths: string[]
  /** Records of each target locale, keyed by hash. */
  records: Map<string, Map<string, TranslationRecord>>
}

/** A translated entry that the loader set. */
interface OwnedEntry {
  /** File path of the entry in the store, relative to the project root. */
  storedPath: string
  /** Absolute path of the source file. */
  source: string
  /** Absolute path of the virtual file, for MDX entries. */
  module?: string
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
  const { data, ...globOptions } = options
  const source = glob(globOptions)
  return {
    name: 'diglot-loader',
    async load(context) {
      const { config, logger, store, watcher } = context
      const projectRoot = resolve(fileURLToPath(config.root))
      const translationsRoot = getState().translations.get(projectRoot)
      if (!translationsRoot)
        throw new Error('`diglotLoader()` needs the diglot integration. Add `diglot({ translations })` from `@diglot/astro` to the `integrations` of your Astro config.')
      const cached = new Map(store.entries())
      const pending = new Set<Promise<unknown>>()
      await source.load({ ...context, watcher: watcher && trackHandlers(watcher, pending) })

      if (!existsSync(translationsRoot))
        logger.warn(`The translations directory "${translationsRoot}" does not exist.`)
      let state = await loadTranslations(context, translationsRoot)
      const owned = new Map<string, OwnedEntry>()
      const ids = await syncTranslations(context, state, owned, { cached, data })
      logger.info(`Added ${ids.size} translated ${ids.size === 1 ? 'entry' : 'entries'}.`)

      if (!watcher)
        return
      watcher.add(translationsRoot)
      const base = fileURLToPath(new URL(options.base ?? '.', config.root))
      let timer: ReturnType<typeof setTimeout> | undefined
      let reload = false
      let full = false
      const changed = new Set<string>()
      let queue = Promise.resolve()
      const schedule = (path: string) => {
        if (isInside(translationsRoot, path)) {
          if (isHidden(relative(translationsRoot, path)))
            return
          reload = true
        }
        else if (isInside(base, path) && SOURCE_RE.test(path)) {
          // A page written by hand for a locale replaces the translation of its source.
          if (isTargetId(relative(base, path), state.localePaths))
            full = true
          changed.add(resolve(path))
        }
        else {
          return
        }
        clearTimeout(timer)
        timer = setTimeout(() => {
          const reloading = reload
          const only = reloading || full ? undefined : new Set(changed)
          reload = false
          full = false
          changed.clear()
          queue = queue.then(async () => {
            // The `glob()` loader updates the source entries in its own watcher handlers.
            await Promise.all(pending)
            if (reloading)
              state = await loadTranslations(context, translationsRoot)
            await syncTranslations(context, state, owned, { data, only })
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

/** Returns a view of the watcher that adds the promise of every handler it registers to `pending`. */
function trackHandlers(watcher: Watcher, pending: Set<Promise<unknown>>): Watcher {
  return new Proxy(watcher, {
    get(target, property) {
      if (property === 'on') {
        return (event: string, handler: (...args: unknown[]) => unknown) => {
          target.on(event, (...args: unknown[]) => {
            const promise = Promise.resolve(handler(...args)).catch(() => {})
            pending.add(promise)
            promise.finally(() => pending.delete(promise))
          })
          return target
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function loadTranslations({ config, logger }: LoaderContext, root: string): Promise<TranslationState> {
  if (!config.i18n)
    throw new Error('`diglotLoader()` reads your locales from the `i18n` option of your Astro config. Add `i18n` with a `defaultLocale` and `locales`.')
  const diglot = await loadConfig(root)
  // Astro reads Markdown without MDC, with either processor. MDX files are always read as MDX.
  if (diglot.parser !== 'satteri')
    logger.warn(`\`diglot.config.ts\` extracts Markdown with the \`${diglot.parser}\` parser, which reads MDC. Astro doesn't read MDC, so unless your Markdown uses it, set \`parser: 'satteri'\` and extract again.`)
  const { defaultPath, targets, localePaths, unmatched } = resolveLocales(config.i18n, diglot.locales)
  if (unmatched.length)
    logger.info(`No translations for ${unmatched.map(path => `"${path}"`).join(', ')}, because \`diglot.config.ts\` does not list ${unmatched.length === 1 ? 'that locale' : 'those locales'}.`)
  const records = new Map(await Promise.all(targets.map(async ({ locale }) => [locale, await loadLocale(root, locale)] as const)))
  return { config: diglot, defaultPath, targets, localePaths, records }
}

interface SyncOptions {
  /** Entries of the previous build, which are reused when their digest matches. */
  cached?: Map<string, Entry>
  /** Absolute paths of the source files to sync. Defaults to every source file. */
  only?: Set<string>
  data?: DiglotLoaderOptions['data']
}

/**
 * Sets a translated entry for every source entry and target locale with at least one applied
 * translation, and deletes the translated entries it set before that are no longer produced.
 * A Markdown entry is rendered here, while an MDX entry is deferred to its virtual module.
 * `owned` holds each translated entry that the loader set, by id. Returns the ids of the
 * translated entries.
 */
async function syncTranslations(context: LoaderContext, state: TranslationState, owned: Map<string, OwnedEntry>, { cached, data, only }: SyncOptions = {}): Promise<Set<string>> {
  const { config, generateDigest, logger, parseData, renderMarkdown, store } = context
  const { config: diglot, defaultPath, localePaths, records, targets } = state
  const projectRoot = fileURLToPath(config.root)
  const parser = diglot.parser === 'satteri' ? 'satteri' : 'remark'
  const produced = new Set<string>()
  const entries = store.values()
  const byLowerId = new Map(entries.map(entry => [entry.id.toLowerCase(), entry]))
  const sources = entries.filter(entry => entry.filePath && SOURCE_RE.test(entry.filePath) && !isTargetId(entry.id, localePaths) && (!only || only.has(resolve(projectRoot, entry.filePath))))
  for (const entry of sources) {
    const relativePath = entry.filePath!
    const filePath = resolve(projectRoot, relativePath)
    const mdx = relativePath.endsWith('.mdx')
    const markdown = await readFile(filePath, 'utf8')
    for (const { path, locale } of targets) {
      const id = translatedId(entry.id, defaultPath, path)
      const modulePath = mdx ? translatedModulePath(filePath, path) : filePath
      const storedPath = relative(projectRoot, modulePath)
      const existing = store.get(id) ?? byLowerId.get(id.toLowerCase())
      if (existing && existing.filePath !== storedPath)
        continue
      if (mdx && existsSync(modulePath)) {
        logger.warn(`Skipped the "${path}" translation of "${relativePath}", because "${storedPath}" exists. Rename that file to translate the page.`)
        continue
      }
      let updatedAt = Number.NEGATIVE_INFINITY
      const { markdown: translated, report } = await apply(markdown, records.get(locale)!, {
        file: relativePath,
        parser,
        policy: diglot.policy,
        onSegment: ({ outcome, record }) => {
          const time = outcome === 'translated' && record ? Date.parse(record.updatedAt) : Number.NaN
          if (time > updatedAt)
            updatedAt = time
        },
      })
      const frontmatter = report.applied ? splitFrontmatter(translated) : undefined
      if (!frontmatter)
        continue
      const extra = data?.({ id, localePath: path, locale, source: relativePath, updatedAt: new Date(updatedAt), frontmatter: frontmatter.data })
      produced.add(id)
      owned.set(id, { storedPath, source: filePath, module: mdx ? modulePath : undefined })
      if (mdx)
        setModule(modulePath, translated)
      const digest = generateDigest(extra ? `${translated}\n${JSON.stringify(extra)}` : translated)
      if (existing?.digest === digest)
        continue
      const previous = cached?.get(id)
      if (previous?.digest === digest && previous.filePath === storedPath) {
        store.set(previous)
        continue
      }
      const entryData = await parseData({ id, data: { ...frontmatter.data, ...extra }, filePath })
      if (mdx) {
        store.set({ id, data: entryData, body: frontmatter.body, filePath: storedPath, digest, deferredRender: true })
        continue
      }
      const rendered = await renderMarkdown(translated, { fileURL: pathToFileURL(filePath) })
      store.set({ id, data: entryData, body: frontmatter.body, filePath: storedPath, digest, rendered, assetImports: rendered.metadata?.imagePaths })
    }
  }
  for (const [id, entry] of owned) {
    if (produced.has(id) || (only && !only.has(entry.source)))
      continue
    if (store.get(id)?.filePath === entry.storedPath)
      store.delete(id)
    owned.delete(id)
    if (entry.module && ![...owned.values()].some(other => other.module === entry.module))
      deleteModule(entry.module)
  }
  return produced
}

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return !rel.startsWith('..') && !rel.startsWith('/')
}

function isHidden(path: string): boolean {
  return path.split('/').some(segment => segment.startsWith('.'))
}
