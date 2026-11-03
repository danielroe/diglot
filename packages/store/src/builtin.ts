/** A Node built-in, where the runtime provides `process.getBuiltinModule` (Node, Deno, Bun). */
export function builtin<T>(id: string): T | undefined {
  const runtime = Reflect.get(globalThis, 'process') as { getBuiltinModule?: (id: string) => unknown } | undefined
  return runtime?.getBuiltinModule?.(id) as T | undefined
}
