export type ValuePath = Array<string | number>

/**
 * Yields `[path, value]` for every non-empty string at the given dotted paths. `key[]` walks
 * array items. A literal dotted key (`{ 'navigation.title': ... }`) is read before the nested
 * path (`{ navigation: { title: ... } }`), and `path` names the key that was read.
 */
export function* stringsAtPaths(data: unknown, paths: string[]): Generator<[ValuePath, string]> {
  const found: Array<[ValuePath, string]> = []
  for (const path of paths)
    collect(data, path.split('.'), [], found)
  yield* found
}

function collect(value: unknown, parts: string[], path: ValuePath, found: Array<[ValuePath, string]>): void {
  if (!parts.length) {
    if (typeof value === 'string' && value.trim())
      found.push([path, value])
    return
  }
  if (!value || typeof value !== 'object')
    return
  const record = value as Record<string, unknown>
  for (let n = parts.length; n > 1; n--) {
    const key = parts.slice(0, n).join('.')
    if (key.includes('[]') || !Object.hasOwn(record, key))
      continue
    const before = found.length
    collect(record[key], parts.slice(n), [...path, key], found)
    if (found.length > before)
      return
  }
  const head = parts[0]!
  const rest = parts.slice(1)
  if (head.endsWith('[]')) {
    const key = head.slice(0, -2)
    const items = record[key]
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++)
        collect(items[i], rest, [...path, key, i], found)
    }
    return
  }
  collect(record[head], rest, [...path, head], found)
}

/**
 * The span to replace when swapping the YAML scalar at `start`..`end` (a `yaml` node range) in
 * `source` for a flow scalar. A block scalar's trailing line break stays outside the span, and
 * the comment on its header line is returned as `suffix` to append to the replacement.
 */
export function yamlScalarSpan(source: string, start: number, end: number): { start: number, end: number, suffix: string } {
  while (end > start && (source[end - 1] === '\n' || source[end - 1] === '\r'))
    end--
  const header = /[|>][1-9+-]*[ \t]+(#[^\r\n]*)/y
  header.lastIndex = start
  const comment = header.exec(source)?.[1]
  return { start, end, suffix: comment ? ` ${comment}` : '' }
}

/** Sets the value at `path`, which must exist. */
export function setAtPath(data: unknown, path: ValuePath, value: unknown): void {
  let cursor = data as Record<string | number, unknown>
  for (const key of path.slice(0, -1))
    cursor = cursor[key] as Record<string | number, unknown>
  cursor[path.at(-1)!] = value
}
