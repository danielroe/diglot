import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extract, parse } from '../src/index.ts'

describe('without Node built-ins', () => {
  const runtime = Reflect.get(globalThis, 'process') as { getBuiltinModule?: unknown }
  const { getBuiltinModule } = runtime
  beforeAll(() => {
    runtime.getBuiltinModule = undefined
  })
  afterAll(() => {
    runtime.getBuiltinModule = getBuiltinModule
  })

  it('should slice protected spans from source', async () => {
    const source = 'See [the docs](/docs "Title"){target="_blank"}, `useFetch`{lang="ts"} and <img :zoom="false" src="/a.png">.'
    const { segments, spans } = await extract(await parse(source))
    expect(segments[0]!.placeholders.map(p => p.source + (p.close ?? ''))).toEqual(['[](/docs "Title"){target="_blank"}', '`useFetch`{lang="ts"}', '<img :zoom="false" src="/a.png">'])
    expect(spans).toEqual({ sliced: 3, rendered: 0 })
  })
})
