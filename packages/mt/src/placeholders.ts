import type { Placeholder } from '@diglot/core'
import type { SourceLike } from './types.ts'

const TOKEN = /(?<!\\)\{(\/?)(\d+)\}/g

export interface DedupedSkeleton {
  /** The skeleton with each repeated atomic placeholder replaced by its first id. */
  skeleton: string
  /** Maps a translation of `skeleton` back to the original ids, in order of appearance. */
  expand: (translation: string) => string
}

/**
 * Gives identical atomic placeholders (same type and markdown) one id, so a model sees
 * `{0} ... {0}` for two mentions of the same code span.
 */
export function dedupePlaceholders(skeleton: string, placeholders: Placeholder[]): DedupedSkeleton {
  const first = new Map<string, number>()
  const canonical = new Map<number, number>()
  for (const p of placeholders) {
    if (p.close !== undefined || !p.source)
      continue
    const key = `${p.type}\0${p.name ?? ''}\0${p.source}`
    const id = first.get(key)
    if (id === undefined)
      first.set(key, p.id)
    else
      canonical.set(p.id, id)
  }
  if (!canonical.size)
    return { skeleton, expand: translation => translation }
  const groups = new Map<number, number[]>()
  for (const [, close, raw] of skeleton.matchAll(TOKEN)) {
    const id = Number(raw)
    if (close)
      continue
    const head = canonical.get(id) ?? id
    groups.set(head, [...groups.get(head) ?? [], id])
  }
  return {
    skeleton: skeleton.replace(TOKEN, (token, close: string, raw: string) => close ? token : `{${canonical.get(Number(raw)) ?? raw}}`),
    expand(translation) {
      const seen = new Map<number, number>()
      return translation.replace(TOKEN, (token, close: string, raw: string) => {
        const id = Number(raw)
        const group = groups.get(id)
        if (close || !group || group.length < 2)
          return token
        const k = seen.get(id) ?? 0
        seen.set(id, k + 1)
        return `{${group[k] ?? id}}`
      })
    },
  }
}

interface Token {
  word?: string
  id?: number
}

function tokens(skeleton: string): Token[] {
  const out: Token[] = []
  for (const part of skeleton.split(/((?<!\\)\{\/?\d+\}|\s+)/)) {
    if (!part || /^\s+$/.test(part) || /^\{\/\d+\}$/.test(part))
      continue
    const id = /^\{(\d+)\}$/.exec(part)?.[1]
    out.push(id === undefined ? { word: part } : { id: Number(id) })
  }
  return out
}

interface PlaceholderInfo {
  type?: string
  source?: string
  paired: boolean
}

function info(source: SourceLike, id: number): PlaceholderInfo {
  const p = source.placeholders?.[id]
  return {
    ...(p?.type ? { type: p.type } : {}),
    ...(p?.source ? { source: p.source } : {}),
    paired: p?.close !== undefined ? true : new RegExp(`(?<!\\\\)\\{/${id}\\}`).test(source.skeleton),
  }
}

/** 2 for the same placeholder, 1 for one of the same shape, 0 otherwise. */
function placeholderScore(a: PlaceholderInfo, b: PlaceholderInfo): number {
  if (a.paired !== b.paired || (a.type && b.type && a.type !== b.type))
    return 0
  return a.source && a.source === b.source ? 2 : 1
}

/**
 * Maps the placeholder ids of a previous source onto the ids of the next source by aligning
 * their words and placeholders. Placeholders of the previous source that have no counterpart
 * get fresh ids after the next source's ids.
 */
export function alignPlaceholders(previous: SourceLike, next: SourceLike): Map<number, number> {
  const a = tokens(previous.skeleton)
  const b = tokens(next.skeleton)
  const score = (x: Token, y: Token) => x.word !== undefined
    ? x.word === y.word ? 2 : 0
    : y.id === undefined ? 0 : placeholderScore(info(previous, x.id!), info(next, y.id))
  const best = Array.from({ length: a.length + 1 }, () => Array.from<number>({ length: b.length + 1 }).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const s = score(a[i]!, b[j]!)
      best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, s ? best[i + 1]![j + 1]! + s : 0)
    }
  }
  const map = new Map<number, number>()
  const used = new Set<number>()
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    const s = score(a[i]!, b[j]!)
    if (s && best[i]![j] === best[i + 1]![j + 1]! + s) {
      if (a[i]!.id !== undefined && !map.has(a[i]!.id!) && !used.has(b[j]!.id!)) {
        map.set(a[i]!.id!, b[j]!.id!)
        used.add(b[j]!.id!)
      }
      i++
      j++
    }
    else if (best[i + 1]![j]! >= best[i]![j + 1]!) {
      i++
    }
    else {
      j++
    }
  }
  const nextIds = b.flatMap(t => t.id === undefined ? [] : [t.id])
  for (const t of a) {
    if (t.id === undefined || map.has(t.id))
      continue
    const match = nextIds.find(id => !used.has(id) && placeholderScore(info(previous, t.id!), info(next, id)) === 2)
    if (match !== undefined) {
      map.set(t.id, match)
      used.add(match)
    }
  }
  let fresh = Math.max(next.placeholders?.length ?? 0, ...nextIds.map(id => id + 1), 0)
  for (const t of a) {
    if (t.id !== undefined && !map.has(t.id))
      map.set(t.id, fresh++)
  }
  return map
}

/** Rewrites the placeholder ids of a skeleton or translation through `map`. */
export function renumber(text: string, map: Map<number, number>): string {
  return text.replace(TOKEN, (token, close: string, raw: string) => {
    const id = map.get(Number(raw))
    return id === undefined ? token : `{${close}${id}}`
  })
}
