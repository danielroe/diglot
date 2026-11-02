/**
 * Regression checks against the Nuxt docs. Expects shallow clones of nuxt/nuxt branches:
 *
 *   git clone --depth 1 --branch main https://github.com/nuxt/nuxt $DIGLOT_CORPUS/nuxt-main
 *   (and 4.x, 3.x into nuxt-4.x, nuxt-3.x)
 *   git clone --depth 1 https://github.com/nuxt/fonts $DIGLOT_CORPUS/nuxt-fonts
 *
 * Usage: node scripts/corpus.ts [--out file.json]
 */
import type { Policy, Segment } from '@diglot/core'
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { findComments } from '@diglot/code'
import { apply as applyComark, extract as extractComark, extractNavigation, parse, render } from '@diglot/comark'
import { diffSegments, isPlaceholderOnly, pseudoTranslate, validate } from '@diglot/core'
import { apply as applyMdast, extract as extractMdast } from '@diglot/mdast'

const { values } = parseArgs({ options: { out: { type: 'string' } } })
const root = process.env.DIGLOT_CORPUS ?? '/tmp/repos'
const branches = ['3.x', '4.x', 'main']
const noComments: Partial<Policy> = { codeComments: false }

interface File { branch: string, path: string, source: string }
const files: File[] = branches.flatMap(branch => globSync(['docs/**/*.md', 'docs/**/.navigation.yml'], { cwd: join(root, `nuxt-${branch}`) })
  .sort()
  .map(path => ({ branch, path, source: readFileSync(join(root, `nuxt-${branch}`, path), 'utf8') })))
const markdown = files.filter(f => f.path.endsWith('.md'))

const comarkCache = new Map<string, Promise<{ withComments: Segment[], without: Segment[] }>>()
function comarkSegments(file: File) {
  const key = `${file.branch}:${file.path}`
  let hit = comarkCache.get(key)
  if (!hit) {
    hit = (async () => {
      if (file.path.endsWith('.yml')) {
        const segments = extractNavigation(file.source, { file: file.path })
        return { withComments: segments, without: segments }
      }
      const doc = await parse(file.source)
      const withComments = (await extractComark(doc, { file: file.path })).segments
      return { withComments, without: withComments.filter(s => s.kind !== 'code-comment') }
    })()
    comarkCache.set(key, hit)
  }
  return hit
}

const reextractKey = (kind: string, skeleton: string) => `${kind}|${skeleton.replace(/\\/g, '')}`
const translatable = (s: Segment) => s.format === 'markdown' && !isPlaceholderOnly(s.skeleton)
const placeholderKey = (s: Segment) => s.placeholders.map(p => ({ type: p.type, source: p.source, close: p.close }))

async function roundTrip() {
  const totals = { units: 0, stable: 0, identityValid: 0, allSegments: 0, allIdentityValid: 0, sliced: 0, rendered: 0 }
  const failures: string[] = []
  for (const file of markdown) {
    const doc = await parse(file.source)
    const { segments, spans } = await extractComark(doc, { file: file.path })
    totals.sliced += spans.sliced
    totals.rendered += spans.rendered
    for (const segment of segments) {
      totals.allSegments++
      if (validate(segment.skeleton, segment).ok)
        totals.allIdentityValid++
      if (!translatable(segment))
        continue
      totals.units++
      if (validate(segment.skeleton, segment).ok)
        totals.identityValid++
      const again = (await extractComark(await parse(segment.text), { policy: noComments })).segments.filter(s => s.format === 'markdown')
      const ok = again.length === 1 && again[0]!.skeleton === segment.skeleton && isDeepStrictEqual(placeholderKey(again[0]!), placeholderKey(segment))
      if (ok)
        totals.stable++
      else
        failures.push(`${file.branch}:${file.path}: ${segment.text.slice(0, 120)} => ${again.map(s => s.skeleton).join(' | ').slice(0, 120)}`)
    }
  }
  return { ...totals, failures: failures.slice(0, 20) }
}

const CORRUPTIONS: Array<[string, (s: string, seg: Segment) => string | undefined]> = [
  ['dropped placeholder', (s, seg) => seg.placeholders.length ? s.replace(/\{0\}/, '') : undefined],
  ['invented placeholder', (s, seg) => `${s} {${seg.placeholders.length}}`],
  ['duplicated link placeholder', (s, seg) => seg.placeholders.some(p => p.close !== undefined) ? `${s} {${seg.placeholders.find(p => p.close !== undefined)!.id}}x{/${seg.placeholders.find(p => p.close !== undefined)!.id}}` : undefined],
  ['smuggled markdown link', s => `${s} [Vite](https://example.com)`],
  ['smuggled image', s => `${s} ![x](https://example.com/x.png)`],
  ['smuggled inline code', s => `${s} \`x\``],
  ['smuggled HTML', s => `${s} <img src=x onerror=alert(1)>`],
  ['smuggled component', s => `${s} :badge[x]`],
  ['smuggled binding', s => `${s} {{ secret }}`],
  ['unbalanced emphasis', s => `**${s}`],
  ['newline in heading', (s, seg) => seg.kind === 'heading' ? `${s}\nmore` : undefined],
  ['blank line', s => `${s}\n\nnew paragraph`],
  ['block syntax', s => `# ${s}`],
]

async function pseudoApply() {
  const totals = { files: 0, segments: 0, applied: 0, rejected: 0, segmentsWithoutComments: 0, appliedWithoutComments: 0, headingIdsTree: 0, headingIdsTreeKept: 0, headingIdsRendered: 0, headingIdsRenderedKept: 0, reextractMismatch: 0 }
  const rejected: string[] = []
  const mismatches: string[] = []
  const corruption: Record<string, { tried: number, caught: number, missed: string[] }> = {}
  for (const file of markdown.filter(f => f.branch === 'main')) {
    totals.files++
    const doc = await parse(file.source)
    const { segments } = await extractComark(doc, { file: file.path })
    const translations = new Map(segments.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)]))
    const { doc: out, report } = await applyComark(doc, translations, { file: file.path })
    totals.segments += segments.length
    totals.applied += report.applied
    totals.rejected += report.rejected.length
    const commentless = report.rejected.filter(r => segments[r.index]?.kind !== 'code-comment').length
    totals.segmentsWithoutComments += segments.filter(s => s.kind !== 'code-comment').length
    totals.appliedWithoutComments += segments.filter(s => s.kind !== 'code-comment').length - commentless
    for (const r of report.rejected.slice(0, 3))
      rejected.push(`${file.path}: ${segments[r.index]?.skeleton.slice(0, 100)} (${r.errors.map(e => e.code).join(', ')})`)

    const ids = (nodes: unknown[]): string[] => nodes.flatMap(n => Array.isArray(n) ? [...(/^h[1-6]$/.test(String(n[0])) && n[1]?.id ? [String(n[1].id)] : []), ...ids(n.slice(2))] : [])
    const before = ids(doc.nodes)
    const tree = new Set(ids(out.nodes))
    const rendered = new Set(ids((await parse(await render(out))).nodes))
    totals.headingIdsTree += before.length
    totals.headingIdsRendered += before.length
    totals.headingIdsTreeKept += before.filter(id => tree.has(id)).length
    totals.headingIdsRenderedKept += before.filter(id => rendered.has(id)).length

    const expected = segments.filter(s => s.kind !== 'code-label').map(s => reextractKey(s.kind, pseudoTranslate(s.skeleton, s.format)))
    const actual = new Set((await extractComark(out, { file: file.path })).segments.map(s => reextractKey(s.kind, s.skeleton)))
    const missing = expected.filter(e => !actual.has(e))
    totals.reextractMismatch += missing.length
    mismatches.push(...missing.map(m => `${file.path}: ${m.slice(0, 120)}`))

    for (const segment of segments) {
      if (segment.format !== 'markdown')
        continue
      for (const [name, corrupt] of CORRUPTIONS) {
        const bad = corrupt(pseudoTranslate(segment.skeleton), segment)
        if (bad === undefined)
          continue
        const c = corruption[name] ??= { tried: 0, caught: 0, missed: [] }
        c.tried++
        if (!validate(bad, segment).ok)
          c.caught++
        else if (c.missed.length < 3)
          c.missed.push(bad.slice(0, 120))
      }
    }
  }
  return { ...totals, rejectedExamples: rejected.slice(0, 10), mismatches: mismatches.slice(0, 20), corruption }
}

async function mdastAgreement() {
  const totals = { files: 0, comark: 0, mdast: 0, matched: 0, sameSourceHash: 0, comarkWithComments: 0, matchedWithComments: 0 }
  const disagreements: Array<{ file: string, comark?: string, mdast?: string }> = []
  const pseudoMdast = { segments: 0, applied: 0, reextractMismatch: 0, rejected: [] as string[], mismatches: [] as string[] }
  for (const file of markdown) {
    totals.files++
    const { withComments, without } = await comarkSegments(file)
    const mdastAll = await extractMdast(file.source, { file: file.path })
    const mdast = mdastAll.filter(s => s.kind !== 'code-comment')
    totals.comark += without.length
    totals.mdast += mdast.length
    const count = (a: Segment[], b: Segment[], key: 'hash' | 'sourceHash') => {
      const pool = new Map<string, number>()
      for (const s of b)
        pool.set(s[key], (pool.get(s[key]) ?? 0) + 1)
      let n = 0
      for (const s of a) {
        const left = pool.get(s[key]) ?? 0
        if (left > 0) {
          pool.set(s[key], left - 1)
          n++
        }
      }
      return n
    }
    totals.matched += count(without, mdast, 'hash')
    totals.sameSourceHash += count(without, mdast, 'sourceHash')
    totals.comarkWithComments += withComments.length
    totals.matchedWithComments += count(withComments, mdastAll, 'hash')
    const diff = diffSegments(without, mdast)
    for (const m of diff.modified)
      disagreements.push({ file: `${file.branch}:${file.path}`, comark: `[${m.before.kind}] ${m.before.skeleton.slice(0, 140)}`, mdast: `[${m.after.kind}] ${m.after.skeleton.slice(0, 140)}` })
    for (const r of diff.removed)
      disagreements.push({ file: `${file.branch}:${file.path}`, comark: `[${r.kind}] ${r.skeleton.slice(0, 140)}` })
    for (const a of diff.added)
      disagreements.push({ file: `${file.branch}:${file.path}`, mdast: `[${a.kind}] ${a.skeleton.slice(0, 140)}` })

    if (file.branch === 'main') {
      const translations = new Map(mdastAll.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)]))
      const { markdown: out, report } = await applyMdast(file.source, translations, { file: file.path })
      pseudoMdast.segments += mdastAll.length
      pseudoMdast.applied += report.applied
      pseudoMdast.rejected.push(...report.rejected.map(r => `${file.path}: ${mdastAll[r.index]?.skeleton.slice(0, 100)} (${r.errors.map(e => e.message).join(', ')})`))
      const again = new Set((await extractMdast(out)).map(s => reextractKey(s.kind, s.skeleton)))
      const missing = mdastAll.filter(s => s.kind !== 'code-label').map(s => reextractKey(s.kind, pseudoTranslate(s.skeleton, s.format))).filter(k => !again.has(k))
      pseudoMdast.reextractMismatch += missing.length
      pseudoMdast.mismatches.push(...missing.map(m => `${file.path}: ${m.slice(0, 120)}`))
    }
  }
  return { ...totals, pct: +(100 * totals.matched / totals.comark).toFixed(2), pctWithComments: +(100 * totals.matchedWithComments / totals.comarkWithComments).toFixed(2), sourceHashPct: +(100 * totals.sameSourceHash / totals.comark).toFixed(2), pseudoMdast, disagreementCount: disagreements.length, disagreements }
}

async function dedupe() {
  const result: Record<string, { units: number, unique: number }> = {}
  for (const withComments of [false, true]) {
    const hashes = new Set<string>()
    let units = 0
    for (const file of files) {
      const segments = (await comarkSegments(file))[withComments ? 'withComments' : 'without']
      for (const s of segments.filter(s => !isPlaceholderOnly(s.skeleton))) {
        units++
        hashes.add(s.hash)
      }
    }
    result[withComments ? 'withComments' : 'withoutComments'] = { units, unique: hashes.size }
  }
  return result
}

async function codeComments() {
  const totals = { blocks: 0, blocksWithComments: 0, lines: 0, segments: 0 }
  const byLanguage: Record<string, { blocks: number, lines: number }> = {}
  const visit = (node: unknown) => {
    if (!Array.isArray(node))
      return
    if (node[0] === 'pre') {
      const language = String(node[1].language ?? '')
      const code = (node.slice(2).find(Array.isArray) ?? []).slice(2).filter((c: unknown) => typeof c === 'string').join('')
      const comments = findComments(code, language)
      totals.blocks++
      totals.lines += comments.length
      if (comments.length) {
        totals.blocksWithComments++
        const entry = byLanguage[language || '(none)'] ??= { blocks: 0, lines: 0 }
        entry.blocks++
        entry.lines += comments.length
      }
      return
    }
    node.slice(2).forEach(visit)
  }
  for (const file of markdown.filter(f => f.branch === 'main')) {
    (await parse(file.source)).nodes.forEach(visit)
    totals.segments += (await comarkSegments(file)).withComments.filter(s => s.kind === 'code-comment').length
  }
  return { ...totals, byLanguage }
}

async function moduleRepo(name: string) {
  const cwd = join(root, name)
  const totals = { files: 0, segments: 0, applied: 0, mdastMatched: 0 }
  for (const path of globSync('docs/**/*.md', { cwd }).sort()) {
    const source = readFileSync(join(cwd, path), 'utf8')
    const doc = await parse(source)
    const { segments } = await extractComark(doc, { file: path })
    const { report } = await applyComark(doc, new Map(segments.map(s => [s.hash, pseudoTranslate(s.skeleton, s.format)])))
    const mdast = new Set((await extractMdast(source)).map(s => s.hash))
    totals.files++
    totals.segments += segments.length
    totals.applied += report.applied
    totals.mdastMatched += segments.filter(s => mdast.has(s.hash)).length
  }
  return totals
}

const started = Date.now()
const report = {
  files: { total: files.length, markdown: markdown.length },
  roundTrip: await roundTrip(),
  pseudoApply: await pseudoApply(),
  mdast: await mdastAgreement(),
  dedupe: await dedupe(),
  codeComments: await codeComments(),
  fonts: await moduleRepo('nuxt-fonts'),
  seconds: 0,
}
report.seconds = Math.round((Date.now() - started) / 1000)
if (values.out)
  writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, mdast: { ...report.mdast, disagreements: report.mdast.disagreements.slice(0, 60) } }, null, 2))
