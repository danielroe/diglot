import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'
import { diglotLoader } from '../../../../src/index.ts'

const docs = defineCollection({
  loader: diglotLoader({ base: './src/content/docs', pattern: '**/*.{md,mdx}' }),
  schema: z.object({ title: z.string(), description: z.string().optional() }),
})

export const collections = { docs }
