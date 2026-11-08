import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'
import { diglotLoader } from '../../../../src/index.ts'

const docs = defineCollection({
  loader: diglotLoader({
    base: './src/content/docs',
    pattern: '**/*.{md,mdx}',
    data: ({ frontmatter, locale, localePath, source, updatedAt }) => ({
      title: `${frontmatter.title} (${locale})`,
      translation: `${localePath} ${source} ${updatedAt?.toISOString() ?? 'undated'}`,
      translatedAt: updatedAt && BigInt(updatedAt.getTime()),
    }),
  }),
  schema: z.object({ title: z.string(), description: z.string().optional(), translation: z.string().optional(), translatedAt: z.bigint().optional() }),
})

export const collections = { docs }
