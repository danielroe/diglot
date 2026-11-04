import { basename, join, posix } from 'node:path'
import { defineNuxtModule } from 'nuxt/kit'

interface OgImageFont {
  src?: string
  absolutePath?: string
}

/**
 * Points the OG image fonts that `@nuxt/fonts` emits as build assets at their cached files, so
 * prerendered OG images render in the site's fonts.
 *
 * TODO: remove once docus depends on `nuxt-og-image` v7, which resolves these fonts itself.
 */
export default defineNuxtModule({
  meta: { name: 'og-image-fonts' },
  setup(_options, nuxt) {
    if (nuxt.options.dev)
      return

    const prefix = posix.join(nuxt.options.app.buildAssetsDir, 'fonts/')
    const cacheDir = join(nuxt.options.buildDir, 'cache', 'fonts')

    nuxt.hook('nitro:config', (config) => {
      const original = config.virtual?.['#og-image/fonts']
      if (typeof original !== 'function')
        return

      config.virtual!['#og-image/fonts'] = async () => {
        const code = await original()
        const fonts: OgImageFont[] = JSON.parse(code.replace(/^export default /, ''))
        for (const font of fonts) {
          if (font.src?.startsWith(prefix) && !font.absolutePath)
            font.absolutePath = join(cacheDir, basename(font.src))
        }
        return `export default ${JSON.stringify(fonts)}`
      }
    })
  },
})
