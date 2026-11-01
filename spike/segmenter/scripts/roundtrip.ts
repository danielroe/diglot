import { isDeepStrictEqual } from 'node:util'
import { writeFileSync } from 'node:fs'
import type { Node } from 'comark'
import { createMarkdownParser } from 'comark'
import { renderMarkdown } from 'comark/render'
import { extract, parse, parseInline, parserOptions, stripPositions, toInline } from '../src/adapters/comark.ts'
import { isPlaceholderOnly, normalise, toPlaceholderForm } from '../src/core/skeleton.ts'
import { validate } from '../src/core/validate.ts'
import { readTree } from '../src/git.ts'

const refs = process.argv.slice(2).length ? process.argv.slice(2) : ['3.x', '4.x', 'HEAD']

interface Failure { ref: string, file: string, category: string, detail: string }
const failures: Failure[] = []
const totals = { files: 0, docOk: 0, placeholderOnly: 0, units: 0, unitTextOk: 0, unitHashOk: 0, identityValid: 0 }

async function parsePlain(source: string) {
  const tree = await createMarkdownParser(parserOptions)(source)
  return { ...tree, nodes: stripPositions(tree.nodes) }
}

for (const ref of refs) {
  for (const { path, source } of readTree(ref)) {
    totals.files++
    const a = await parsePlain(source)
    const b = await parsePlain(await renderMarkdown(a))
    if (isDeepStrictEqual(a.nodes, b.nodes) && isDeepStrictEqual(a.frontmatter, b.frontmatter)) {
      totals.docOk++
    } else {
      const [x, y] = firstDiff(a.nodes, b.nodes) ?? ['frontmatter', 'frontmatter']
      failures.push({ ref, file: path, category: `doc:${categorise(x, y)}`, detail: `${show(x, 300)}\n    => ${show(y, 300)}` })
    }

    const { segments } = await extract(path, await parse(source))
    for (const seg of segments) {
      if (seg.format !== 'markdown') continue
      if (isPlaceholderOnly(seg.skeleton)) {
        totals.placeholderOnly++
        continue
      }
      totals.units++
      const check = validate(seg.skeleton, seg)
      if (check.ok) totals.identityValid++
      else failures.push({ ref, file: path, category: `validate:${check.errors[0]!.replace(/ at \d+$/, '')}`, detail: seg.skeleton })

      const inline = await parseInline(seg.text)
      if (!inline) {
        failures.push({ ref, file: path, category: 'unit:not-a-paragraph', detail: seg.text })
        continue
      }
      const again = toPlaceholderForm(normalise(await toInline(inline)))
      if (again.skeleton === seg.skeleton) totals.unitHashOk++
      else failures.push({ ref, file: path, category: 'unit:skeleton-changed', detail: `${seg.skeleton}\n    => ${again.skeleton}` })
      const sameSources = isDeepStrictEqual(again.placeholders, seg.placeholders)
      if (again.skeleton === seg.skeleton && sameSources) totals.unitTextOk++
      else if (again.skeleton === seg.skeleton) failures.push({ ref, file: path, category: 'unit:placeholder-source-changed', detail: `${seg.text}\n    ${JSON.stringify(again.placeholders.filter((p, i) => !isDeepStrictEqual(p, seg.placeholders[i])))}` })
    }
  }
}

function show(value: unknown, max: number) {
  return String(JSON.stringify(value)).slice(0, max)
}

function firstDiff(a: Node[], b: Node[]): [unknown, unknown] | undefined {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i]
    if (isDeepStrictEqual(x, y)) continue
    if (Array.isArray(x) && Array.isArray(y) && x[0] === y[0] && isDeepStrictEqual(x[1], y[1])) {
      return firstDiff(x.slice(2) as Node[], y.slice(2) as Node[]) ?? [x, y]
    }
    return [x, y]
  }
}

function categorise(x: unknown, y: unknown): string {
  const tag = (n: unknown) => Array.isArray(n) ? String(n[0]) : typeof n === 'string' ? 'text' : String(n)
  if (Array.isArray(x) && Array.isArray(y) && x[0] === y[0]) return `${tag(x)}-attrs`
  return `${tag(x)}->${tag(y)}`
}

const byCategory = Object.entries(Object.groupBy(failures, f => f.category))
  .map(([category, list]) => ({ category, count: list!.length, examples: list!.slice(0, 4) }))
  .sort((a, b) => b.count - a.count)

writeFileSync(new URL('../out/roundtrip.json', import.meta.url), JSON.stringify({ refs, totals, byCategory }, null, 2))
console.log(totals)
for (const c of byCategory) {
  console.log(`\n## ${c.category} (${c.count})`)
  for (const e of c.examples) console.log(`  ${e.ref}:${e.file}\n    ${e.detail}`)
}
