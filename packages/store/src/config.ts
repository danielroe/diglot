import type { DiffOptions, DiglotConfig, MtConfig, Policy, SourceConfig } from '@diglot/core'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadConfig as loadC12 } from 'c12'
import { join, resolve } from 'pathe'
import { parseSources } from './sources.ts'

/** A loaded `diglot.config.ts` with defaults applied and paths resolved. */
export interface ResolvedConfig {
  /** Directory of the translations repository. */
  root: string
  locales: string[]
  sources: SourceConfig[]
  parser: 'comark' | 'mdast'
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

/** Loads `diglot.config.*` from `cwd` (via c12) and the sources it points at. */
export async function loadConfig(cwd = '.', overrides: Partial<DiglotConfig> = {}): Promise<ResolvedConfig> {
  const { config } = await loadC12<DiglotConfig>({ name: 'diglot', cwd, overrides: overrides as DiglotConfig, rcFile: false, dotenv: false, packageJson: false, globalRc: false, jitiOptions: { alias: coreAlias() } })
  return resolveConfig(config, resolve(cwd))
}

/** Lets a config import `@diglot/core` without installing it next to the config. */
function coreAlias(): Record<string, string> {
  try {
    return { '@diglot/core': fileURLToPath(import.meta.resolve('@diglot/core')) }
  }
  catch {
    return {}
  }
}

/** Applies defaults to a config object and loads its sources. */
export async function resolveConfig(config: Partial<DiglotConfig>, root: string): Promise<ResolvedConfig> {
  const locales = config.locales ?? []
  for (const locale of locales) {
    if (!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/.test(locale))
      throw new Error(`invalid locale "${locale}", expected a BCP 47 tag such as "fr" or "pt-BR"`)
  }
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
