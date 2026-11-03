import { afterAll, beforeAll } from 'vitest'

/** Hides `process.getBuiltinModule` for the current file, as on runtimes without Node built-ins. */
export function withoutBuiltins(): void {
  const runtime = Reflect.get(globalThis, 'process') as { getBuiltinModule?: unknown } | undefined
  const original = runtime?.getBuiltinModule
  beforeAll(() => {
    if (runtime)
      runtime.getBuiltinModule = undefined
  })
  afterAll(() => {
    if (runtime)
      runtime.getBuiltinModule = original
  })
}
