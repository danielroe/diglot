/** Frontmatter paths that carry prose. `[]` walks every array item. */
export const FRONTMATTER_PROSE = ['title', 'description', 'navigation.title', 'head.title', 'links[].label', 'seo.title', 'seo.description']

export type FrontmatterPath = Array<string | number>

export function* frontmatterProse(fm: Record<string, unknown>, keys = FRONTMATTER_PROSE): Generator<[FrontmatterPath, string]> {
  for (const key of keys) yield* collect(fm, key.split('.'), [])
}

function* collect(value: unknown, parts: string[], path: FrontmatterPath): Generator<[FrontmatterPath, string]> {
  if (!parts.length) {
    if (typeof value === 'string' && value.trim()) yield [path, value]
    return
  }
  if (!value || typeof value !== 'object') return
  const [head, ...rest] = parts as [string, ...string[]]
  const record = value as Record<string, unknown>
  if (head.endsWith('[]')) {
    const key = head.slice(0, -2)
    const arr = record[key]
    if (Array.isArray(arr)) {
      for (const [i, item] of arr.entries()) yield* collect(item, rest, [...path, key, i])
    }
    return
  }
  yield* collect(record[head], rest, [...path, head])
}

export function setPath(obj: Record<string, unknown>, path: FrontmatterPath, value: string) {
  let cursor: any = obj
  for (const key of path.slice(0, -1)) cursor = cursor[key]
  cursor[path.at(-1)!] = value
}
