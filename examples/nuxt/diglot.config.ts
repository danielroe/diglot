import { defineConfig } from '@diglot/core'

export default defineConfig({
  locales: ['fr'],
  glossary: 'glossary.yml',
  mt: {
    model: 'anthropic/claude-sonnet-5.5',
    subject: 'the documentation of Nuxt, a Vue web framework',
    batch: 'page',
    qaRetries: 1,
  },
})
