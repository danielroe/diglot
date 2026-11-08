import { getCollection } from 'astro:content'

export async function GET() {
  const docs = await getCollection('docs')
  return Response.json(Object.fromEntries(docs.map(({ id, data }) => [id, data.lastUpdated ?? null])))
}
