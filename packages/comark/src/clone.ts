/**
 * Deep copy that keeps shared and cyclic references, as `structuredClone` does. Arrays and
 * plain objects are copied directly; other objects go through `structuredClone`.
 */
export function clone<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== 'object')
    return value
  const known = seen.get(value)
  if (known !== undefined)
    return known as T
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value)
      out.push(clone(item, seen))
    return out as T
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    const out = structuredClone(value)
    seen.set(value, out)
    return out
  }
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const key of Object.keys(value)) {
    const item = clone((value as Record<string, unknown>)[key], seen)
    if (key === '__proto__')
      Object.defineProperty(out, key, { value: item, enumerable: true, writable: true, configurable: true })
    else
      out[key] = item
  }
  return out as T
}
