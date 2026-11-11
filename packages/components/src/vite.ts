import type { Policy, Segment, TranslationRecord } from '@diglot/core'
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import { readdir, readFile } from 'node:fs/promises'
import { resolveTranslation } from '@diglot/core'
import { loadConfig, loadLocale, parseRecordFile, parseRecordPath } from '@diglot/store'
import { join, relative, resolve } from 'pathe'
import { isComponent, transform } from './index.ts'

export interface DiglotPluginOptions {
  /**
   * Directory of the translations repository, the one that holds `diglot.config.ts`, relative to the
   * Vite root. Without it, components render in the source locale.
   */
  translations?: string
  /** The locale the components are written in. Defaults to `en`. */
  sourceLocale?: string
}

const VIRTUAL = 'virtual:diglot'
const RESOLVED = `\0${VIRTUAL}`
const IGNORED = new Set(['node_modules', 'dist', 'build', 'coverage'])

async function* components(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.'))
      continue
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      yield* components(path)
    else if (isComponent(entry.name))
      yield path
  }
}

/**
 * The Vite plugin. It rewrites every Vue, React and Svelte component before its framework's plugin
 * compiles it, and serves `virtual:diglot`: the source locale and a loader for each locale's catalog,
 * built from the records of the translations repository. When a record changes, pages update in place.
 */
export default function diglot(options: DiglotPluginOptions = {}): Plugin {
  const sourceLocale = options.sourceLocale ?? 'en'
  const files = new Map<string, Segment[]>()
  const records = new Map<string, Map<string, TranslationRecord>>()
  /** The catalog of each locale module loaded so far, as JSON. */
  const sent = new Map<string, string>()
  let config: ResolvedConfig
  let server: ViteDevServer | undefined
  let translations: string | undefined
  let policy: Partial<Policy> | undefined

  function catalog(locale: string): Record<string, string> {
    const out: Record<string, string> = {}
    const translated = records.get(locale)!
    for (const segment of [...files.values()].flat()) {
      if (segment.hash in out || !translated.has(segment.hash))
        continue
      const resolution = resolveTranslation(segment, translated)
      if (resolution.status === 'ok')
        out[segment.hash] = resolution.skeleton
    }
    return out
  }

  return {
    name: '@diglot/components',
    enforce: 'pre',
    async configResolved(resolved) {
      config = resolved
      if (!options.translations)
        return
      translations = resolve(config.root, options.translations)
      const diglotConfig = await loadConfig(translations)
      policy = diglotConfig.policy
      for (const locale of diglotConfig.locales)
        records.set(locale, await loadLocale(translations, locale))
    },
    async buildStart() {
      // Every component, not only the ones this build imports, so that no catalog misses a segment.
      for await (const file of components(config.root)) {
        const key = relative(config.root, file)
        if (!files.has(key))
          files.set(key, (await transform(await readFile(file, 'utf8'), { file: key, policy }))?.segments ?? [])
      }
    },
    resolveId(id) {
      if (id === VIRTUAL)
        return RESOLVED
      if (id.startsWith(`${VIRTUAL}/`))
        return `\0${id}`
    },
    load(id) {
      if (id === RESOLVED) {
        const loaders = [...records.keys()].map(locale => `${JSON.stringify(locale)}: () => import(${JSON.stringify(`${VIRTUAL}/${locale}`)}).then(m => m.default)`)
        return [
          `export default { sourceLocale: ${JSON.stringify(sourceLocale)}, locales: { ${loaders.join(', ')} } }`,
          'if (import.meta.hot) {',
          `  import.meta.hot.on('diglot:locale', ({ locale, catalog }) => {`,
          `    for (const ref of globalThis[Symbol.for('@diglot/components')] ?? [])`,
          '      ref.deref()?.update(locale, catalog)',
          '  })',
          '}',
        ].join('\n')
      }
      const locale = id.startsWith(`${RESOLVED}/`) ? id.slice(RESOLVED.length + 1) : undefined
      if (locale && records.has(locale)) {
        const json = JSON.stringify(catalog(locale))
        sent.set(locale, json)
        return `export default ${json}`
      }
    },
    async transform(code, id) {
      if (!isComponent(id) || id.includes('/node_modules/') || /[?&]type=/.test(id))
        return
      const path = id.replace(/[?#].*$/, '')
      const key = relative(config.root, path)
      const result = await transform(code, { file: key, policy })
      files.set(key, result?.segments ?? [])
      sendChanged()
      for (const skipped of result?.skipped ?? [])
        this.warn(`${key}:${skipped.line} is not translated (${skipped.reason}): ${skipped.text}`)
      if (result?.segments.length)
        return { code: result.code, map: { ...result.map, sources: [path] } }
    },
    configureServer(devServer) {
      server = devServer
      if (translations)
        server.watcher.add(translations)
    },
    async hotUpdate({ type, file, read }) {
      const path = translations && file.startsWith(`${translations}/`) ? parseRecordPath(relative(translations, file)) : undefined
      const translated = path && records.get(path.locale)
      if (!translated)
        return
      if (this.environment.name === 'client') {
        const record = type === 'delete' ? undefined : parseRecordFile(await read(), path.hash)
        if (record)
          translated.set(path.hash, record)
        else
          translated.delete(path.hash)
        sendChanged()
      }
      return []
    },
  }

  /** Sends each loaded catalog that changed to the browser, and invalidates its module. */
  function sendChanged() {
    if (!server)
      return
    for (const [locale, before] of sent) {
      const after = catalog(locale)
      const json = JSON.stringify(after)
      if (json === before)
        continue
      sent.set(locale, json)
      for (const environment of Object.values(server.environments)) {
        const module = environment.moduleGraph.getModuleById(`${RESOLVED}/${locale}`)
        if (module)
          environment.moduleGraph.invalidateModule(module)
      }
      server.environments.client.hot.send({ type: 'custom', event: 'diglot:locale', data: { locale, catalog: after } })
    }
  }
}
