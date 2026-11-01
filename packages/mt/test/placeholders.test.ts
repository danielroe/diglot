import { describe, expect, it } from 'vitest'
import { alignPlaceholders, dedupePlaceholders, renumber } from '../src/placeholders.ts'
import { segment } from './helpers.ts'

describe('dedupePlaceholders', () => {
  it('should give identical atomic placeholders one id and restore them in order', async () => {
    const s = await segment('Call `useFetch` with [docs](/a), then `useFetch` again and [docs](/a).')
    expect(s.skeleton).toBe('Call {0} with {1}docs{/1}, then {2} again and {3}docs{/3}.')
    const deduped = dedupePlaceholders(s.skeleton, s.placeholders)
    expect(deduped.skeleton).toBe('Call {0} with {1}docs{/1}, then {0} again and {3}docs{/3}.')
    expect(deduped.expand('Appelez {0} avec {1}docs{/1}, puis {0} et {3}docs{/3}.')).toBe('Appelez {0} avec {1}docs{/1}, puis {2} et {3}docs{/3}.')
    expect(deduped.expand('{0} {0} {0}')).toBe('{0} {2} {0}')
  })

  it('should leave skeletons without repeats untouched', async () => {
    const s = await segment('Use `a` and `b`.')
    const deduped = dedupePlaceholders(s.skeleton, s.placeholders)
    expect(deduped.skeleton).toBe(s.skeleton)
    expect(deduped.expand('{1} {0}')).toBe('{1} {0}')
  })
})

describe('alignPlaceholders', () => {
  it('should follow placeholders when new ones are inserted before them', async () => {
    const before = await segment('Read the [guide](/guide) and use `useFetch`.')
    const after = await segment('Use `$fetch` or read the [guide](/guide) and use `useFetch`.')
    const map = alignPlaceholders(before, after)
    expect(map).toEqual(new Map([[0, 1], [1, 2]]))
    expect(renumber('Lisez le {0}guide{/0} et utilisez {1}.', map)).toBe('Lisez le {1}guide{/1} et utilisez {2}.')
  })

  it('should give removed placeholders fresh ids and match changed code by position', async () => {
    const before = await segment('Use `useFetch` or `$fetch` to get data.')
    const after = await segment('Use `useAsyncData` to get data.')
    expect(alignPlaceholders(before, after)).toEqual(new Map([[0, 0], [1, 1]]))
    expect(alignPlaceholders({ skeleton: 'Use {0} or {1} to get data.' }, { skeleton: 'Use {0} to get data.' })).toEqual(new Map([[0, 0], [1, 1]]))
  })

  it('should match moved placeholders by their markdown', async () => {
    const before = await segment('First `a`, then the [docs](/d).')
    const after = await segment('See the [docs](/d) after `a`.')
    expect(alignPlaceholders(before, after)).toEqual(new Map([[0, 1], [1, 0]]))
  })
})
