import { docsSchema } from '@astrojs/starlight/schema'
import { defineCollection } from 'astro:content'
import { diglotDocsLoader } from '../../../../src/index.ts'

export const collections = {
  docs: defineCollection({ loader: diglotDocsLoader(), schema: docsSchema() }),
}
