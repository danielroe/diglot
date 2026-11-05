import mdx from '@astrojs/mdx'
import { defineConfig } from 'astro/config'
import diglot from '../../../src/index.ts'

export default defineConfig({
  integrations: [mdx(), diglot({ translations: './translations' })],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr', { path: 'pt-br', codes: ['pt-BR'] }, 'de'],
  },
})
