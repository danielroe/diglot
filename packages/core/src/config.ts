import type { DiffOptions } from './diff.ts'
import type { Policy } from './policy.ts'

/** A repository, ref and directory whose documents feed the corpus. */
export interface SourceConfig {
  /** Unique name, used for the manifest file. */
  name: string
  /** `owner/repo` on GitHub, for reference and for tooling that clones sources. */
  repo?: string
  /** Git ref to read. Without it, the working tree at `path` is read. */
  ref?: string
  /** Local checkout, relative to the config file. */
  path?: string
  /** Directory inside the checkout. Defaults to the checkout root. */
  dir?: string
  /** Glob patterns relative to `dir`. Defaults to markdown files and `.navigation.yml`. */
  include?: string[]
  exclude?: string[]
}

/** Configuration of a translations repository (`diglot.config.ts`). */
export interface DiglotConfig {
  /** Target locales. */
  locales: string[]
  /** Path to `sources.yml`, or the sources themselves. Defaults to `sources.yml`. */
  sources?: string | SourceConfig[]
  /** Markdown parser used for extraction. Defaults to `comark`. */
  parser?: 'comark' | 'mdast'
  policy?: Partial<Policy>
  diff?: DiffOptions
  /** Directory for built locale files. Defaults to `dist`. */
  outDir?: string
  /** Directory for generated state such as manifests. Defaults to `.diglot`. */
  stateDir?: string
}

/** Identity helper that types a `diglot.config.ts`. */
export function defineConfig(config: DiglotConfig): DiglotConfig {
  return config
}
