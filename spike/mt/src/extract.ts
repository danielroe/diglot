import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { mask } from './placeholders.ts'

export type SegmentKind = 'title' | 'description' | 'heading' | 'paragraph' | 'list-item' | 'callout'

export interface Segment {
  id: string
  file: string
  kind: SegmentKind
  level?: number
  text: string
  pageTitle: string
  headingTrail: string[]
}

function parseFrontmatter (src: string): { data: Record<string, string>, body: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) { return { data: {}, body: src } }
  const data: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^(title|description):\s*(.*)$/)
    if (kv) { data[kv[1]!] = kv[2]!.trim().replace(/^(['"])(.*)\1$/, '$2') }
  }
  return { data, body: src.slice(m[0].length) }
}

export function extractSegments (file: string, src: string): Segment[] {
  const { data, body } = parseFrontmatter(src)
  const pageTitle = data.title ?? file
  const segments: Segment[] = []
  const trail: string[] = []
  const push = (kind: SegmentKind, text: string, level?: number) => {
    segments.push({ id: `${file}#${segments.length}`, file, kind, level, text, pageTitle, headingTrail: [...trail] })
  }
  if (data.title) { push('title', data.title) }
  if (data.description) { push('description', data.description) }

  const lines = body.split('\n')
  let fence: string | null = null
  let block: string[] = []
  let calloutDepth = 0
  const flush = () => {
    const text = block.join('\n').trim()
    block = []
    if (!text) { return }
    if (/^\s*[-*] |^\s*\d+\. /.test(text)) {
      const items = text.split(/\n(?=\s*(?:[-*]|\d+\.) )/)
      for (const item of items) {
        if (/^\s{2,}/.test(item)) { continue }
        push('list-item', item.replace(/^\s*(?:[-*]|\d+\.) /, '').trim())
      }
      return
    }
    if (text.startsWith('|')) { return }
    push(calloutDepth > 0 ? 'callout' : 'paragraph', text)
  }
  for (const line of lines) {
    if (fence) {
      if (line.trim().startsWith(fence)) { fence = null }
      continue
    }
    const f = line.trim().match(/^(`{3,}|~{3,})/)
    if (f) { flush(); fence = f[1]!; continue }
    if (/^\s*::[a-z-]+/.test(line)) { flush(); calloutDepth++; continue }
    if (/^\s*::\s*$/.test(line)) { flush(); calloutDepth = Math.max(0, calloutDepth - 1); continue }
    if (/^\s*:[a-z-]+\{.*\}\s*$/.test(line)) { flush(); continue }
    const h = line.match(/^(#{1,6}) (.*)$/)
    if (h) {
      flush()
      const level = h[1]!.length
      trail.length = Math.max(0, level - 2)
      push('heading', h[2]!.trim(), level)
      trail.push(h[2]!.trim())
      continue
    }
    if (line.trim() === '') { flush(); continue }
    block.push(line)
  }
  flush()
  return segments
}

const SAMPLE: Array<[string, number]> = [
  ['1.getting-started/10.data-fetching.md', 16],
  ['1.getting-started/14.layers.md', 18],
  ['2.directory-structure/1.app/1.components.md', 14],
  ['4.api/2.composables/use-fetch.md', 6],
  ['4.api/1.components/4.nuxt-link.md', 3],
]

const SYNTHETIC: Array<Omit<Segment, 'id' | 'file' | 'pageTitle' | 'headingTrail'>> = [
  { kind: 'paragraph', text: 'The :badge{label="Nuxt 4" color="success"} release renames the source directory to `app/`; see the [upgrade guide](/docs/getting-started/upgrade#new-directory-structure) for details.' },
  { kind: 'paragraph', text: 'Press :kbd{value="Ctrl"} + :kbd{value="K"} to open the search, then type <code>useState</code> and hit <kbd>Enter</kbd>.' },
  { kind: 'paragraph', text: 'Inside the template you can interpolate values with `{{ count }}`, but writing {{ $t(\'welcome\') }} directly in markdown renders the raw expression.' },
  { kind: 'list-item', text: ':u-icon{name="i-lucide-check"} **Server routes** in `server/api/` are auto-imported by Nitro and exposed under [`/api`](/docs/directory-structure/server#api-routes).' },
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs')
  const out: Segment[] = []
  for (const [file, n] of SAMPLE) {
    const segs = extractSegments(file, readFileSync(resolve(root, file), 'utf8'))
    out.push(...segs.slice(0, n))
  }
  SYNTHETIC.forEach((s, i) => out.push({ ...s, id: `synthetic#${i}`, file: 'synthetic', pageTitle: 'Synthetic placeholder stress cases', headingTrail: [] }))
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'segments.json'), JSON.stringify(out, null, 2) + '\n')
  const files = execSync('find . -name "*.md" | sort', { cwd: root }).toString().trim().split('\n').map(f => f.slice(2))
  const stress = stressSet(root, files).map(s => ({ ...s, file: 'stress' }))
  writeFileSync(resolve(dir, 'stress.json'), JSON.stringify(stress, null, 2) + '\n')
  console.log(stress.length, 'stress segments')
  console.log(out.length, 'segments')
  for (const s of out) { console.log(s.id, s.kind, JSON.stringify(s.text.slice(0, 80))) }
}

export function stressSet (root: string, files: string[], n = 20): Segment[] {
  const all: Array<Segment & { n: number }> = []
  for (const f of files) {
    for (const s of extractSegments(f, readFileSync(resolve(root, f), 'utf8'))) {
      if (s.text.includes(' | ')) { continue }
      try { all.push({ ...s, n: mask(s.text).tokens.length }) }
      catch {}
    }
  }
  return all.sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)).slice(0, n).map(({ n: _n, ...s }) => s)
}
