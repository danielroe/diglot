import mdx from '@astrojs/mdx'
import diglot from '@diglot/astro'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [mdx(), diglot({ translations: './translations' })],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de', 'ja'],
  },
  trailingSlash: 'always',
})
