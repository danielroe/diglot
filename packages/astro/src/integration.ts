import type { AstroIntegration } from 'astro'
import { fileURLToPath } from 'node:url'
import { resolve } from 'pathe'
import { getState } from './state.ts'
import { vitePluginDiglot } from './vite.ts'

export interface DiglotOptions {
  /**
   * Directory of the translations repository, the one that holds `diglot.config.ts`, relative to
   * the project root.
   */
  translations: string
}

/**
 * The diglot integration. It passes its options to `diglotLoader()` and serves the translated MDX
 * entries of the loader to `@astrojs/mdx`.
 */
export default function diglot(options: DiglotOptions): AstroIntegration {
  return {
    name: '@diglot/astro',
    hooks: {
      'astro:config:setup': ({ config, updateConfig }) => {
        if (typeof options?.translations !== 'string')
          throw new Error('`diglot()` needs the `translations` option: the directory of your translations repository, relative to the project root.')
        if (!config.i18n)
          throw new Error('`diglot()` reads your locales from the `i18n` option of your Astro config. Add `i18n` with a `defaultLocale` and `locales`.')
        getState().translations = resolve(fileURLToPath(config.root), options.translations)
        updateConfig({ vite: { plugins: [vitePluginDiglot()] } })
      },
    },
  }
}
