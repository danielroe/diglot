import type { EnvironmentProviders, Provider } from '@angular/core'
import type { Policy, PolicySnapshot } from '@diglot/core'
import type { DiglotConfig } from './tokens.ts'
import type { DiglotParser } from './translate.ts'
import { makeEnvironmentProviders } from '@angular/core'
import { restorePolicy } from '@diglot/core'
import { DIGLOT_STORE, DiglotStore } from './store.ts'
import { DIGLOT_CONFIG, DIGLOT_LOCALE } from './tokens.ts'
import { resolveParser } from './translate.ts'

export interface DiglotOptions {
  /** The locale your documents are written in. Documents in this locale are shown as they are, without fetching a bundle. */
  defaultLocale: string
  /**
   * Returns the locale to show. It is read in a reactive context, so it can read signals, and
   * documents follow it when it changes. Defaults to `defaultLocale`. A locale feature such as
   * `withDiglotRouteLocale()` takes its place.
   */
  locale?: () => string
  /** The URL of the bundle `diglot build` writes for `locale`, `dist/<locale>.json` in the translations repository. */
  bundleUrl: (locale: string) => string
  /** The URL of the source Markdown of the document at `path`. */
  sourceUrl: (path: string) => string
  /**
   * The policy snapshot in `.diglot/policy.json` of the translations repository. Translations are
   * matched to the source by hashes, which only agree under the policy they were extracted with.
   */
  policy: PolicySnapshot
  /** Functions of the policy that its snapshot lists in `custom`, as `restorePolicy` takes them. */
  policyFunctions?: Partial<Pick<Policy, 'codeLabel' | 'salt'>>
  /** The parser of the translations repository, its `parser` config option. */
  parser: DiglotParser
}

/** An option of `provideDiglot()` that brings its own providers, such as `withDiglotRouteLocale()`. */
export interface DiglotFeature {
  kind: 'locale'
  providers: Provider[]
}

/**
 * Sets up diglot for an application: where its bundles and source documents are, and which
 * locale to show. Use `diglotDocument()` in components to read a document in that locale.
 */
export function provideDiglot(options: DiglotOptions, ...features: DiglotFeature[]): EnvironmentProviders {
  const config = resolveConfig(options)
  const locale = options.locale ?? (() => config.defaultLocale)
  return makeEnvironmentProviders([
    { provide: DIGLOT_CONFIG, useValue: config },
    { provide: DIGLOT_LOCALE, useValue: locale },
    { provide: DIGLOT_STORE, useFactory: () => new DiglotStore() },
    ...features.flatMap(feature => feature.providers),
  ])
}

function resolveConfig({ locale: _, policy, policyFunctions, ...options }: DiglotOptions): DiglotConfig {
  if (!policy)
    throw new Error('[@diglot/angular] `policy` is required: pass the snapshot in `.diglot/policy.json` of your translations repository.')
  let restored: Policy
  try {
    restored = restorePolicy(policy, policyFunctions)
  }
  catch (error) {
    throw new Error(`[@diglot/angular] cannot restore \`policy\`: ${(error as Error).message}. Pass the snapshot in \`.diglot/policy.json\` of your translations repository.`, { cause: error })
  }
  return { ...options, parser: resolveParser(options.parser), policy: restored }
}
