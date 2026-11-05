import { diglotLoader } from '@diglot/astro'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const docs = defineCollection({
  loader: diglotLoader({
    pattern: '**/*.{md,mdx}',
    base: './src/content/docs',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
})

export const collections = { docs }
