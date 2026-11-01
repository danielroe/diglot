import { parse as parseYaml } from 'yaml'
import { unified } from 'unified'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdc from 'remark-mdc'
import remarkParse from 'remark-parse'
import { frontmatterProse } from '../core/frontmatter.ts'
import { BREAK_SOURCE, isProseCodeLabel, kindForContainers, PROSE_PROPS } from '../core/policy.ts'
import { buildSegments } from '../core/segment.ts'
import type { InlineNode, Segment, SegmentDraft, SegmentKind } from '../core/types.ts'

/**
 * Minimal mdast adapter (remark-parse + remark-gfm + remark-mdc), extraction only.
 * Protected spans take their markdown from the source slice, so no renderer is needed.
 */

interface MdNode {
  type: string
  children?: MdNode[]
  value?: string
  name?: string
  depth?: number
  lang?: string | null
  meta?: string | null
  alt?: string | null
  attributes?: Record<string, unknown>
  position?: { start: { line: number, offset?: number }, end: { line: number, offset?: number } }
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdc).use(remarkFrontmatter)

export async function extractRemark(file: string, source: string): Promise<Segment[]> {
  const root = await processor.run(processor.parse(source)) as MdNode
  const drafts: SegmentDraft[] = []
  let trail: string[] = []
  let line: [number, number] = [1, 1]
  const slice = (n: MdNode) => source.slice(n.position!.start.offset, n.position!.end.offset)
  const ctx = (containers: string[], detail?: string) => ({ headingTrail: trail.filter(Boolean), containers, ...(detail ? { detail } : {}) })
  const pos = () => ({ startLine: line[0], endLine: line[1], precision: 'block' as const })

  const push = (kind: SegmentKind, nodes: MdNode[], containers: string[], detail?: string) => {
    for (const img of findImages(nodes)) {
      if (img.alt?.trim()) drafts.push({ kind: 'image-alt', content: img.alt, context: ctx(containers, 'alt'), position: pos() })
    }
    drafts.push({ kind, content: toInline(nodes), context: ctx(containers, detail), position: pos() })
  }

  const toInline = (nodes: MdNode[]): InlineNode[] => {
    const out: InlineNode[] = []
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      switch (n.type) {
        case 'text':
          out.push({ type: 'text', value: n.value! })
          break
        case 'strong':
        case 'emphasis':
        case 'delete':
          out.push({ type: n.type, children: toInline(n.children!) })
          break
        case 'inlineCode':
          out.push({ type: 'atomic', kind: 'code', source: slice(n) })
          break
        case 'break':
          out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE })
          break
        case 'image':
          out.push({ type: 'atomic', kind: 'image', source: slice(n) })
          break
        case 'link': {
          const kids = n.children ?? []
          if (!kids.length) {
            out.push({ type: 'atomic', kind: 'link', source: slice(n) })
            break
          }
          const open = source.slice(n.position!.start.offset, kids[0]!.position!.start.offset)
          const close = source.slice(kids.at(-1)!.position!.end.offset, n.position!.end.offset)
          out.push({ type: 'link', children: toInline(kids), open, close })
          break
        }
        case 'textComponent':
          if (n.name === 'br') out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE })
          else if (n.name === 'binding') out.push({ type: 'atomic', kind: 'binding', source: slice(n) })
          else out.push({ type: 'atomic', kind: 'component', name: n.name, source: slice(n), ...(/\p{L}/u.test(textOf(n.children ?? [])) ? { hidesText: true } : {}) })
          break
        case 'html': {
          if (/^<\/?br\s*\/?>$/i.test(n.value!)) {
            out.push({ type: 'atomic', kind: 'break', source: BREAK_SOURCE })
            break
          }
          const open = /^<([a-z][\w-]*)[^>]*>$/i.exec(n.value!)
          const closeAt = open ? nodes.findIndex((m, j) => j > i && m.type === 'html' && m.value === `</${open[1]}>`) : -1
          const end = closeAt >= 0 ? nodes[closeAt]! : n
          out.push({ type: 'atomic', kind: 'html', name: open?.[1], source: source.slice(n.position!.start.offset, end.position!.end.offset) })
          if (closeAt >= 0) i = closeAt
          break
        }
        default:
          out.push({ type: 'atomic', kind: 'other', source: slice(n) })
      }
    }
    return out
  }

  const props = (node: MdNode, containers: string[]) => {
    const attrs = { ...(node as any).fmAttributes, ...node.attributes }
    for (const prop of PROSE_PROPS[node.name!] ?? []) {
      const value = attrs[prop]
      if (typeof value === 'string' && value.trim()) drafts.push({ kind: 'prop', content: value, context: ctx(containers, prop), position: pos() })
    }
  }

  const visit = (n: MdNode, containers: string[]) => {
    switch (n.type) {
      case 'yaml': {
        const fm = (parseYaml(n.value!) ?? {}) as Record<string, unknown>
        for (const [path, value] of frontmatterProse(fm)) {
          drafts.push({ kind: 'frontmatter', content: value, context: ctx([], path.join('.')), position: { startLine: 1, endLine: 1, precision: 'file' } })
        }
        return
      }
      case 'heading': {
        push('heading', n.children!, containers, `h${n.depth}`)
        const level = n.depth!
        trail = Array.from({ length: level }, (_, i) => i < level - 1 ? (trail[i] ?? '') : textOf(n.children!))
        return
      }
      case 'paragraph': {
        const kids = n.children!.filter(c => !(c.type === 'text' && !c.value!.trim()))
        if (kids.length === 1 && kids[0]!.type === 'textComponent' && kids[0]!.name !== 'br') {
          props(kids[0]!, [...containers, kids[0]!.name!])
          return
        }
        return push(kindForContainers(containers), n.children!, containers)
      }
      case 'tableCell':
        return push('table-cell', n.children!, containers)
      case 'code': {
        const label = /\[([^\]]+)\]/.exec(n.meta ?? '')?.[1]
        if (label && isProseCodeLabel(label)) drafts.push({ kind: 'code-label', content: label, context: ctx(containers, 'filename'), position: pos() })
        return
      }
      case 'html':
      case 'thematicBreak':
        return
      case 'list':
      case 'table':
      case 'tableRow':
        for (const c of n.children!) visit(c, n.type === 'table' ? [...containers, 'table'] : containers)
        return
      case 'listItem':
      case 'blockquote':
        for (const c of n.children!) visit(c, [...containers, n.type === 'listItem' ? 'li' : 'blockquote'])
        return
      case 'textComponent':
        props(n, [...containers, n.name!])
        return
      case 'containerComponent': {
        const inner = [...containers, n.name!]
        props(n, inner)
        for (const c of n.children!) visit(c, inner)
        return
      }
      case 'componentContainerSection': {
        const inner = [...containers.slice(0, -1), `${containers.at(-1)}#${n.name}`]
        for (const c of n.children!) visit(c, inner)
        return
      }
      default:
        for (const c of n.children ?? []) visit(c, containers)
    }
  }

  for (const child of root.children!) {
    line = [child.position?.start.line ?? 1, child.position?.end.line ?? 1]
    visit(child, [])
  }
  return buildSegments(file, drafts)
}

function findImages(nodes: MdNode[]): MdNode[] {
  return nodes.flatMap(n => n.type === 'image' ? [n] : findImages(n.children ?? []))
}

function textOf(nodes: MdNode[]): string {
  return nodes.map(n => n.value ?? textOf(n.children ?? [])).join('')
}

