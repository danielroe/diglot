import type { NodeRange, TextRange } from '@x18n/core'

function stringEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\')
      i += 2
    else if (ch === '"')
      return i + 1
    else
      i++
  }
  return text.length
}

/** Ranges of the top-level properties of a JSON object, keyed by property name. Values are ranges of the whole value, quotes included. */
export function topLevelRanges(text: string, from = 0, to = text.length): Map<string, NodeRange> {
  const out = new Map<string, NodeRange>()
  let depth = 0
  let key: { name: string, range: TextRange } | undefined
  let valueStart: number | undefined
  for (let i = from; i < to; i++) {
    const ch = text[i]!
    if (ch === '"') {
      const end = stringEnd(text, i)
      if (depth === 1 && valueStart === undefined && !key) {
        key = { name: JSON.parse(text.slice(i, end)) as string, range: { start: i, end } }
      }
      else if (depth === 1 && key && valueStart === undefined) {
        out.set(key.name, { key: key.range, value: { start: i, end } })
        key = undefined
      }
      i = end - 1
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 1 && key && valueStart === undefined)
        valueStart = i
      depth++
    }
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 1 && key && valueStart !== undefined) {
        out.set(key.name, { key: key.range, value: { start: valueStart, end: i + 1 } })
        key = undefined
        valueStart = undefined
      }
    }
    else if (depth === 1 && key && valueStart === undefined && /[-\w]/.test(ch)) {
      let end = i
      while (end < to && /[-+.\w]/.test(text[end]!))
        end++
      out.set(key.name, { key: key.range, value: { start: i, end } })
      key = undefined
      i = end - 1
    }
  }
  return out
}
