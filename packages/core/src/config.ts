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

/** Machine translation settings of a translations repository. */
export interface MtConfig {
  /** Model id for the default provider (the Vercel AI Gateway), for example `anthropic/claude-sonnet-5.5`. */
  model?: string
  /** What is being translated, for prompts, for example `the documentation of Nuxt, a Vue web framework`. */
  subject?: string
  /** Segments per request, or `page` for one request per page. Defaults to `page`. */
  batch?: 'page' | number
  /** Retries for segments that fail an error-level QA check. Defaults to `1`. */
  qaRetries?: number
}

/** Per-locale state, as stored in `<locale>/locale.yml`. */
export interface LocaleState {
  /** Machine translation runs only for locales with `enabled: true`. */
  mt?: { enabled?: boolean }
  /** Review metrics behind the `mt.enabled` decision, as written by a governance job. */
  governance?: {
    /** GitHub logins that reviewed something recently. */
    activeReviewers?: string[]
    /** Share of machine translations accepted by reviewers, 0 to 1. */
    approvalRate?: number
    /** Median days from machine translation to review. */
    reviewLatencyDays?: number
    /** ISO 8601 timestamp. */
    updatedAt?: string
  }
}

/** Configuration of a translations repository (`diglot.config.ts`). */
export interface DiglotConfig {
  /** Target locales. */
  locales: string[]
  /** Path to `sources.yml`, or the sources themselves. Defaults to `sources.yml`. */
  sources?: string | SourceConfig[]
  /**
   * Markdown parser used for extraction. `comark` and `mdast` read MDC; `satteri` is the mdast adapter
   * parsing with Sätteri, for markdown without MDC such as Astro sites. Defaults to `comark`.
   */
  parser?: 'comark' | 'mdast' | 'satteri'
  policy?: Partial<Policy>
  diff?: DiffOptions
  /** Directory for built locale files. Defaults to `dist`. */
  outDir?: string
  /** Directory for generated state such as manifests. Defaults to `.diglot`. */
  stateDir?: string
  /** Glossary shared by every locale, in x18n's `glossary` shape. Defaults to `glossary.yml` when it exists. */
  glossary?: string
  mt?: MtConfig
}

/** Identity helper that types a `diglot.config.ts`. */
export function defineConfig(config: DiglotConfig): DiglotConfig {
  return config
}
