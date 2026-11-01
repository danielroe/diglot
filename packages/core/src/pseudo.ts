import type { SegmentFormat } from './types.ts'
import { tokenize } from './grammar.ts'

const ACCENTS: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' }

/**
 * Pseudo-translates a skeleton: every run of text containing letters is wrapped in `⟦ ⟧`
 * and its vowels are accented. Placeholders, emphasis markers and escapes are kept, so the
 * result is a valid translation of the source.
 */
export function pseudoTranslate(skeleton: string, format: SegmentFormat = 'markdown'): string {
  let out = ''
  let run = ''
  const flush = () => {
    if (/\p{L}/u.test(run)) {
      const body = run.trim()
      const start = run.indexOf(body)
      out += `${run.slice(0, start)}⟦${body.replace(/[aeiou]/gi, v => ACCENTS[v]!)}⟧${run.slice(start + body.length)}`
    }
    else {
      out += run
    }
    run = ''
  }
  for (const token of tokenize(skeleton, { markers: format === 'markdown' })) {
    if (token.type === 'char') {
      run += token.escaped ? `\\${token.value}` : token.value
      continue
    }
    flush()
    out += token.type === 'marker' ? token.value : token.type === 'open' ? `{${token.id}}` : `{/${token.id}}`
  }
  flush()
  return out
}
