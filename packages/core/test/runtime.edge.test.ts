import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSegment, hashSkeleton, recordStatus, validate } from '../src/index.ts'

describe('without Node built-ins', () => {
  const runtime = Reflect.get(globalThis, 'process') as { getBuiltinModule?: unknown }
  const { getBuiltinModule } = runtime
  beforeAll(() => {
    runtime.getBuiltinModule = undefined
  })
  afterAll(() => {
    runtime.getBuiltinModule = getBuiltinModule
  })

  it('should hash, validate and derive statuses', () => {
    expect(hashSkeleton('Nuxt fetches data with {0}.')).toBe('31e679009ae869ec')
    expect(hashSkeleton('Hello', 'salt', 'plain')).toBe('ec93f40f64b80087')
    const segment = buildSegment({ kind: 'paragraph', content: [{ type: 'text', value: 'Nuxt fetches data with ' }, { type: 'atomic', kind: 'code', source: '`useFetch`' }, { type: 'text', value: '.' }], context: { headingTrail: [], containers: [] }, position: { startLine: 1, endLine: 1, precision: 'file' } }, { file: 'a.md', index: 0 })!
    expect(segment.hash).toBe('31e679009ae869ec')
    expect(validate('Nuxt récupère des données avec {0}.', segment).ok).toBe(true)
    expect(recordStatus(undefined)).toBe('untranslated')
  })
})
