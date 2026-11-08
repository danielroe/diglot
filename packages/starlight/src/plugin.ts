import type { StarlightPlugin } from '@astrojs/starlight/types'
import type { DiglotOptions } from '@diglot/astro'
import { fileURLToPath } from 'node:url'
import diglot from '@diglot/astro'
import { resolve } from 'pathe'
import { getSettings } from './state.ts'

export type DiglotStarlightOptions = DiglotOptions

/**
 * The diglot plugin for Starlight. It adds the `@diglot/astro` integration after Starlight, which
 * sets Astro's `i18n` option from the `locales` of the Starlight config, and passes the edit link
 * and last updated settings to `diglotDocsLoader()`.
 */
export default function diglotStarlight(options: DiglotStarlightOptions): StarlightPlugin {
  return {
    name: '@diglot/starlight',
    hooks: {
      'config:setup': ({ addIntegration, astroConfig, config: starlightConfig, logger }) => {
        if (!starlightConfig.locales)
          logger.warn('Starlight has no `locales`, so there are no languages to translate into. Add `locales` to the Starlight config.')
        getSettings().set(resolve(fileURLToPath(astroConfig.root)), {
          editLinkBaseUrl: starlightConfig.editLink?.baseUrl,
          lastUpdated: Boolean(starlightConfig.lastUpdated),
        })
        addIntegration(diglot(options))
      },
    },
  }
}
