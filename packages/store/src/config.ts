import type { DiffOptions, DiglotConfig, MtConfig, Policy, SourceConfig } from '@diglot/core'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'pathe'
import { parseSources } from './sources.ts'

/** A loaded `diglot.config.ts` with defaults applied and paths resolved. */
export interface ResolvedConfig {
  /** Directory of the translations repository. */
  root: string
  locales: string[]
  sources: SourceConfig[]
  parser: 'comark' | 'mdast' | 'satteri'
  policy: Partial<Policy>
  diff: DiffOptions
  /** Absolute output directory for locale bundles. */
  outDir: string
  /** Absolute state directory. */
  stateDir: string
  /** Absolute path of the shared glossary, when there is one. */
  glossary?: string
  mt: MtConfig
}

const CONFIG_FILES = ['diglot.config.ts', 'diglot.config.mts', 'diglot.config.js', 'diglot.config.mjs']

/** Loads `diglot.config.{ts,mts,js,mjs}` from `cwd` and the sources it points at. */
export async function loadConfig(cwd = '.', overrides: Partial<DiglotConfig> = {}): Promise<ResolvedConfig> {
  const root = resolve(cwd)
  const file = CONFIG_FILES.map(name => join(root, name)).find(path => existsSync(path))
  const config = file ? await importConfig(file) : {}
  return resolveConfig({ ...config, ...overrides }, root)
}

async function importConfig(path: string): Promise<Partial<DiglotConfig>> {
  aliasCore()
  const url = pathToFileURL(path)
  url.searchParams.set('mtime', String((await stat(path)).mtimeMs))
  const mod = await import(url.href) as { default?: Partial<DiglotConfig> }
  return mod.default ?? {}
}

let aliased = false

/** Lets a config import `@diglot/core` without installing it next to the config. */
function aliasCore(): void {
  if (aliased)
    return
  aliased = true
  let core: string
  try {
    core = import.meta.resolve('@diglot/core')
  }
  catch {
    return
  }
  registerHooks({
    resolve: (specifier, context, next) => specifier === '@diglot/core' ? { url: core, shortCircuit: true } : next(specifier, context),
  })
}

/** Applies defaults to a config object and loads its sources. */
export async function resolveConfig(config: Partial<DiglotConfig>, root: string): Promise<ResolvedConfig> {
  const locales = config.locales ?? []
  for (const locale of locales) {
    if (!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/.test(locale))
      throw new Error(`invalid locale "${locale}", expected a BCP 47 tag such as "fr" or "pt-BR"`)
  }
  if (config.parser !== undefined && !['comark', 'mdast', 'satteri'].includes(config.parser))
    throw new Error(`invalid parser "${config.parser}", expected "comark", "mdast" or "satteri"`)
  const sources = Array.isArray(config.sources)
    ? config.sources
    : await readFile(join(root, config.sources ?? 'sources.yml'), 'utf8').then(parseSources, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' && config.sources === undefined)
          return []
        throw error
      })
  return {
    root,
    locales,
    sources,
    parser: config.parser ?? 'comark',
    policy: config.policy ?? {},
    diff: config.diff ?? {},
    outDir: resolve(root, config.outDir ?? 'dist'),
    stateDir: resolve(root, config.stateDir ?? '.diglot'),
    ...(config.glossary ? { glossary: resolve(root, config.glossary) } : existsSync(join(root, 'glossary.yml')) ? { glossary: join(root, 'glossary.yml') } : {}),
    mt: config.mt ?? {},
  }
}
