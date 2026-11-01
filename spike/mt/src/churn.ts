import { execSync } from 'node:child_process'
import { extractSegments } from './extract.ts'
import { mask } from './placeholders.ts'
import { sentences } from './diff.ts'

const sh = (c: string) => { try { return execSync(c, { cwd: new URL('../../..', import.meta.url), maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString() } catch { return '' } }
const since = process.argv[2] ?? '6 months ago'
const exclude = new Set((process.env.EXCLUDE ?? '').split(',').filter(Boolean))
const commits = sh(`git log --since="${since}" --format=%h -- docs`).trim().split('\n').filter(c => c && !exclude.has(c))
const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean))
const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length / new Set([...a, ...b]).size
const safeMask = (s: string) => { try { return mask(s).masked } catch { return s } }

const stats = { commits: commits.length, modified: 0, carry: 0, whitespaceOrMarkupOnly: 0, model: 0, added: 0, removed: 0, sentencesChanged: [] as number[] }
for (const c of commits) {
  const files = sh(`git diff --name-only ${c}^ ${c} -- docs`).trim().split('\n').filter(f => f.endsWith('.md'))
  for (const f of files) {
    const a = sh(`git show ${c}^:${f}`)
    const b = sh(`git show ${c}:${f}`)
    const sa = a ? extractSegments(f, a) : []
    const sb = b ? extractSegments(f, b) : []
    const setA = new Set(sa.map(s => s.text))
    const setB = new Set(sb.map(s => s.text))
    const removed = sa.filter(s => !setB.has(s.text))
    const added = sb.filter(s => !setA.has(s.text))
    const used = new Set<number>()
    for (const r of removed) {
      const wr = words(r.text)
      let best = -1
      let score = 0.5
      added.forEach((n, i) => { if (used.has(i)) { return } const j = jaccard(wr, words(n.text)); if (j >= score) { score = j; best = i } })
      if (best < 0) { stats.removed++; continue }
      used.add(best)
      stats.modified++
      const n = added[best]!
      const ma = safeMask(r.text)
      const mb = safeMask(n.text)
      if (ma === mb) { stats.carry++; continue }
      const norm = (s: string) => s.replace(/[_*]/g, '').replace(/\s+/g, ' ').trim()
      if (norm(ma) === norm(mb)) { stats.whitespaceOrMarkupOnly++; continue }
      stats.model++
      const sa2 = sentences(ma, 'en')
      const sb2 = sentences(mb, 'en')
      stats.sentencesChanged.push(Math.max(sa2.filter(s => !sb2.includes(s)).length, sb2.filter(s => !sa2.includes(s)).length))
    }
    stats.added += added.length - used.size
  }
}
const hist = stats.sentencesChanged.reduce<Record<string, number>>((h, n) => ({ ...h, [n >= 3 ? '3+' : String(n)]: (h[n >= 3 ? '3+' : String(n)] ?? 0) + 1 }), {})
console.log(JSON.stringify({ ...stats, sentencesChanged: undefined, sentencesChangedHistogram: hist }, null, 1))
