import type { ComarkDocument } from '../src/index.ts'
import { describe, expect, it, vi } from 'vitest'
import { apply, extract } from '../src/index.ts'

const loaded = vi.hoisted(() => new Set<string>())
vi.mock('comark', async (original) => {
  loaded.add('comark')
  return original()
})
vi.mock('comark/render', async (original) => {
  loaded.add('comark/render')
  return original()
})

describe('module loading', () => {
  it('should apply translations without loading the comark parser or renderer', async () => {
    const doc: ComarkDocument = { frontmatter: {}, nodes: [['p', {}, 'Read ', ['code', {}, 'useFetch'], '.']] }
    const [segment] = (await extract(doc, { spanSources: false })).segments
    const { doc: translated } = await apply(doc, new Map([[segment!.hash, 'Lisez {0}.']]))
    expect(translated.nodes).toEqual([['p', {}, 'Lisez ', ['code', {}, 'useFetch'], '.']])
    expect(loaded).toEqual(new Set())
  })
})
