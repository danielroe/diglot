import { writeFileSync } from 'node:fs'
import { extract, parse } from '../src/adapters/comark.ts'
import { extractRemark } from '../src/adapters/remark.ts'
import { diffSegments } from '../src/core/diff.ts'
import { isPlaceholderOnly } from '../src/core/skeleton.ts'
import { readTree } from '../src/git.ts'

const refs = process.argv.slice(2).length ? process.argv.slice(2) : ['HEAD']
const totals = { files: 0, comark: 0, remark: 0, matched: 0, matchedTranslatable: 0, comarkTranslatable: 0, sameSourceHash: 0 }
const mismatches: Array<{ file: string, comark?: string, remark?: string }> = []
const byKind: Record<string, { comark: number, matched: number }> = {}

for (const ref of refs) {
  for (const { path, source } of readTree(ref, 'docs', undefined, p => p.endsWith('.md'))) {
    totals.files++
    const a = (await extract(path, await parse(source))).segments
    const b = await extractRemark(path, source)
    totals.comark += a.length
    totals.remark += b.length
    const d = diffSegments(a, b)
    const pool = new Map<string, number>()
    for (const s of b) pool.set(s.hash, (pool.get(s.hash) ?? 0) + 1)
    const poolSource = new Map<string, number>()
    for (const s of b) poolSource.set(s.sourceHash, (poolSource.get(s.sourceHash) ?? 0) + 1)
    for (const s of a) {
      const k = byKind[s.kind] ??= { comark: 0, matched: 0 }
      k.comark++
      const translatable = !isPlaceholderOnly(s.skeleton)
      if (translatable) totals.comarkTranslatable++
      const n = pool.get(s.hash) ?? 0
      if (n > 0) {
        pool.set(s.hash, n - 1)
        totals.matched++
        k.matched++
        if (translatable) totals.matchedTranslatable++
      }
      const m = poolSource.get(s.sourceHash) ?? 0
      if (m > 0) {
        poolSource.set(s.sourceHash, m - 1)
        totals.sameSourceHash++
      }
    }
    for (const m of d.modified) mismatches.push({ file: path, comark: m.before.skeleton.slice(0, 160), remark: m.after.skeleton.slice(0, 160) })
    for (const r of d.removed) mismatches.push({ file: path, comark: `[${r.kind}] ${r.skeleton.slice(0, 140)}` })
    for (const r of d.added) mismatches.push({ file: path, remark: `[${r.kind}] ${r.skeleton.slice(0, 140)}` })
  }
}

const result = {
  refs,
  totals: { ...totals, matchedPct: +(100 * totals.matched / totals.comark).toFixed(2), matchedTranslatablePct: +(100 * totals.matchedTranslatable / totals.comarkTranslatable).toFixed(2), sameSourceHashPct: +(100 * totals.sameSourceHash / totals.comark).toFixed(2) },
  byKind,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 80),
}
writeFileSync(new URL('../out/parser-independence.json', import.meta.url), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ...result, mismatches: result.mismatches.slice(0, 40) }, null, 2))
