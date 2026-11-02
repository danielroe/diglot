export type ValuePath = Array<string | number>

/**
 * Yields `[path, value]` for every non-empty string at the given dotted paths. `key[]` walks
 * array items. A literal dotted key (`{ 'navigation.title': ... }`) is read before the nested
 * path (`{ navigation: { title: ... } }`), and `path` names the key that was read.
 */
export function* stringsAtPaths(data: unknown, paths: string[]): Generator<[ValuePath, string]> {
  for (const path of paths)
    yield* collect(data, path.split('.'), [])
}

function* collect(value: unknown, parts: string[], path: ValuePath): Generator<[ValuePath, string]> {
  if (!parts.length) {
    if (typeof value === 'string' && value.trim())
      yield [path, value]
    return
  }
  if (!value || typeof value !== 'object')
    return
  const record = value as Record<string, unknown>
  for (let n = parts.length; n > 1; n--) {
    const key = parts.slice(0, n).join('.')
    if (key.includes('[]') || !Object.hasOwn(record, key))
      continue
    const found = [...collect(record[key], parts.slice(n), [...path, key])]
    if (found.length) {
      yield* found
      return
    }
  }
  const [head, ...rest] = parts as [string, ...string[]]
  if (head.endsWith('[]')) {
    const key = head.slice(0, -2)
    const items = record[key]
    if (Array.isArray(items)) {
      for (const [i, item] of items.entries())
        yield* collect(item, rest, [...path, key, i])
    }
    return
  }
  yield* collect(record[head], rest, [...path, head])
}

/** Sets the value at `path`, which must exist. */
export function setAtPath(data: unknown, path: ValuePath, value: unknown): void {
  let cursor = data as Record<string | number, unknown>
  for (const key of path.slice(0, -1))
    cursor = cursor[key] as Record<string | number, unknown>
  cursor[path.at(-1)!] = value
}
