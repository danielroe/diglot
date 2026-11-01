import { writeFileSync } from 'node:fs'
import { apply, extract, parse, render } from '../src/adapters/comark.ts'
import type { Segment } from '../src/core/types.ts'
import { validate } from '../src/core/validate.ts'
import { readTree } from '../src/git.ts'

const ACCENTS: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' }

/** Pseudo-locale: accents vowels outside placeholders and escapes, keeps everything else. */
function pseudo(skeleton: string): string {
  return skeleton.replace(/(\\.|\{\/?\d+\}|%s)|[aeiouAEIOU]/g, (m, keep) => keep ?? ACCENTS[m]!)
}

const corruptions: Array<[string, (s: string, seg: Segment) => string | undefined]> = [
  ['drop placeholder', (s, seg) => seg.placeholders.length ? s.replace(/\{0\}/, '') : undefined],
  ['duplicate placeholder', (s, seg) => seg.placeholders.length ? `${s} {0}` : undefined],
  ['inline code', s => `${s} \`x\``],
  ['link', s => `${s} [x](https://evil.example)`],
  ['raw HTML', s => `${s} <img src=x onerror=alert(1)>`],
  ['inline component', s => `${s} :badge[x]`],
  ['binding', s => `${s} {{ secret }}`],
  ['blank line', s => `${s}\n\nnew paragraph`],
  ['newline in heading', (s, seg) => seg.kind === 'heading' ? `${s}\nmore` : undefined],
  ['unbalanced emphasis', s => `**${s}`],
  ['block syntax', s => `# ${s}`],
]

const stats = { files: 0, segments: 0, applied: 0, rejected: 0, rejectedExamples: [] as any[], reextractMismatch: 0, mismatchExamples: [] as any[], headingIdsKept: 0, headingIdsLost: 0, corruption: {} as Record<string, { tried: number, caught: number, missed: string[] }> }

for (const { path, source } of readTree('HEAD')) {
  stats.files++
  const doc = await parse(source)
  const { segments } = await extract(path, doc)
  stats.segments += segments.length
  const translations = new Map(segments.map(s => [s.hash, pseudo(s.skeleton)]))
  const result = await apply(doc, translations)
  stats.applied += result.applied
  stats.rejected += result.rejected.length
  if (stats.rejectedExamples.length < 8) stats.rejectedExamples.push(...result.rejected.slice(0, 2).map(r => ({ file: path, ...r, skeleton: segments.find(s => s.hash === r.hash)?.skeleton })))

  const output = await render(result.doc)
  const again = await extract(path, await parse(output))
  // Image placeholders legitimately change (their alt is a separate, translated segment), and
  // code labels are selected by a source-language heuristic that accented output no longer matches.
  const key = (s: Segment, skeleton: string) => `${s.kind}|${skeleton}|${s.placeholders.map(p => p.type === 'image' ? 'img' : p.source + (p.close ?? '')).join('§')}`
  const expected = segments.filter(s => s.kind !== 'code-label').map(s => key(s, pseudo(s.skeleton)))
  const actual = again.segments.map(s => key(s, s.skeleton))
  const missing = expected.filter(e => !actual.includes(e))
  if (missing.length) {
    stats.reextractMismatch += missing.length
    if (stats.mismatchExamples.length < 8) stats.mismatchExamples.push({ file: path, expected: missing[0]!.slice(0, 200), nearest: actual.find(a => a.split('|')[0] === missing[0]!.split('|')[0])?.slice(0, 200) })
  }
  const ids = (nodes: any[]): string[] => nodes.flatMap(n => Array.isArray(n) ? [...(/^h[1-6]$/.test(n[0]) && n[1]?.id ? [n[1].id] : []), ...ids(n.slice(2))] : [])
  const before = ids(doc.nodes)
  const after = new Set(ids((await parse(output)).nodes))
  for (const id of before) after.has(id) ? stats.headingIdsKept++ : stats.headingIdsLost++

  for (const seg of segments) {
    if (seg.format !== 'markdown') continue
    for (const [name, corrupt] of corruptions) {
      const bad = corrupt(pseudo(seg.skeleton), seg)
      if (bad === undefined) continue
      const c = stats.corruption[name] ??= { tried: 0, caught: 0, missed: [] }
      c.tried++
      if (!validate(bad, seg).ok) c.caught++
      else if (c.missed.length < 3) c.missed.push(bad.slice(0, 120))
    }
  }
}

writeFileSync(new URL('../out/apply.json', import.meta.url), JSON.stringify(stats, null, 2))
console.log(JSON.stringify(stats, null, 2))
