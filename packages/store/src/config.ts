import type { DiffOptions, DiglotConfig, Glossary, Policy, SourceConfig } from '@diglot/core'
import { readFile } from 'node:fs/promises'
import { loadConfig as loadC12 } from 'c12'
import { join, resolve } from 'pathe'
import { parse as parseYaml } from 'yaml'
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
}

/** Loads `diglot.config.*` from `cwd` (via c12) and the sources it points at. */
export async function loadConfig(cwd = '.', overrides: Partial<DiglotConfig> = {}): Promise<ResolvedConfig> {
  const { config } = await loadC12<DiglotConfig>({ name: 'diglot', cwd, overrides: overrides as DiglotConfig, rcFile: false, dotenv: false, packageJson: false, globalRc: false })
  return resolveConfig(config, resolve(cwd))
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
  }
}

/** Reads `<locale>/glossary.yml`, or `undefined` when there is none. */
export async function loadGlossary(root: string, locale: string): Promise<Glossary | undefined> {
  const content = await readFile(join(root, locale, 'glossary.yml'), 'utf8').catch(() => undefined)
  if (content === undefined)
    return
  const data = (parseYaml(content) ?? {}) as Partial<Glossary>
  if (!Array.isArray(data.terms))
    throw new Error(`${locale}/glossary.yml: \`terms\` must be a list`)
  for (const [i, entry] of data.terms.entries()) {
    const ok = entry && typeof entry.term === 'string' && (
      entry.decision === 'keep'
      || (entry.decision === 'translate' && typeof entry.target === 'string')
      || (entry.decision === 'keep-gloss' && typeof entry.gloss === 'string'))
    if (!ok)
      throw new Error(`${locale}/glossary.yml: term ${i} needs \`term\` and a valid \`decision\``)
  }
  return { terms: data.terms, ...(data.style ? { style: data.style } : {}) }
}
