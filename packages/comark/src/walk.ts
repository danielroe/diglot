import type { CodeComment } from '@diglot/code'
import type { InlineNode, Policy, SegmentDraft, SegmentKind, SegmentPosition, ValuePath } from '@diglot/core'
import type { ElementNode, Node } from 'comark'
import type { ComarkDocument } from './tree.ts'
import { findComments } from '@diglot/code'
import { frontmatterValues, kindForContainers, proseProps } from '@diglot/core'
import { SourceSlicer } from './slice.ts'
import { children, elementText, isElement } from './tree.ts'

export type Target
  = | { type: 'range', parent: Node[], start: number, end: number }
    | { type: 'attr', attrs: Record<string, unknown>, key: string }
    | { type: 'frontmatter', path: ValuePath }
    | { type: 'code', element: ElementNode, comment: CodeComment }

export interface Unit {
  kind: SegmentKind
  content: Node[] | string | CodeComment
  /** Inline content of a frontmatter value that holds HTML. */
  inline?: InlineNode[]
  language?: string
  context: SegmentDraft['context']
  position: SegmentPosition
  target: Target
  slicer?: SourceSlicer
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const LISTS = new Set(['ul', 'ol'])
const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr'])
const INLINE_TAGS = new Set(['a', 'strong', 'em', 'code', 'del', 's', 'span', 'br', 'img', 'kbd', 'sup', 'sub', 'mark', 'u', 'i', 'b', 'small', 'abbr', 'badge', 'math'])
const UNTRANSLATABLE = new Set(['pre', 'hr', 'video', 'source', 'iframe', 'script', 'style'])

/** Lists the translatable units of a document in order, with a target for applying each. */
export function walk(doc: ComarkDocument, policy: Policy): Unit[] {
  const units: Unit[] = []
  let trail: string[] = []
  let line: [number, number] = [1, 1]
  let slicer: SourceSlicer | undefined
  let fences: number[] = []
  let fenceIndex = 0
  const sourceLines = doc.source?.split('\n')
  const blockPosition = (): SegmentPosition => ({ startLine: line[0], endLine: line[1], precision: doc.lines ? 'block' : 'file' })
  const context = (containers: string[], detail?: string) => ({ headingTrail: trail.filter(Boolean), containers, ...(detail ? { detail } : {}) })
  const isInline = (node: Node) => typeof node === 'string' || (isElement(node) && !policy.htmlText.includes(node[0]) && (INLINE_TAGS.has(node[0]) || node[1].$?.block === 0))
  const isBoundary = (node: Node | undefined, newline: RegExp) => node === undefined || (typeof node === 'string' ? newline.test(node) : !isInline(node))
  const isComponent = (node: Node) => isElement(node) && !isInline(node) && !node[1].$?.html && !policy.htmlText.includes(node[0])
  const isInlineAt = (parent: Node[], i: number, start: number) => {
    if (isInline(parent[i]!))
      return true
    if (!isComponent(parent[i]!))
      return false
    let first = i
    let last = i
    while (first > start && isComponent(parent[first - 1]!))
      first--
    while (last + 1 < parent.length && isComponent(parent[last + 1]!))
      last++
    return !(isBoundary(first > start ? parent[first - 1] : undefined, /\n\s*$/) && isBoundary(parent[last + 1], /^\s*\n/))
  }

  for (const [path, value] of frontmatterValues(doc.frontmatter, policy))
    units.push({ kind: 'frontmatter', ...(typeof value === 'string' ? { content: value } : { content: '', inline: value }), context: context([], path.join('.')), position: { startLine: 1, endLine: 1, precision: 'file' }, target: { type: 'frontmatter', path } })

  const pushInline = (kind: SegmentKind, parent: Node[], start: number, end: number, containers: string[], detail?: string) => {
    const nodes = parent.slice(start, end)
    if (!nodes.some(n => typeof n !== 'string' || n.trim()))
      return
    for (const image of findImages(nodes)) {
      if (typeof image[1].alt === 'string' && image[1].alt.trim())
        units.push({ kind: 'image-alt', content: image[1].alt, context: context(containers, 'alt'), position: blockPosition(), target: { type: 'attr', attrs: image[1], key: 'alt' } })
    }
    units.push({ kind, content: nodes, context: context(containers, detail), position: blockPosition(), target: { type: 'range', parent, start, end }, slicer })
  }

  const pushProps = (node: ElementNode, containers: string[]) => {
    for (const prop of proseProps(policy, node[0])) {
      const value = node[1][prop]
      if (typeof value === 'string' && value.trim())
        units.push({ kind: 'prop', content: value, context: context(containers, prop), position: blockPosition(), target: { type: 'attr', attrs: node[1], key: prop } })
    }
  }

  const pushCode = (node: ElementNode, containers: string[], synced: boolean) => {
    const attrs = node[1]
    const label = attrs.filename
    if (!synced && typeof label === 'string' && policy.codeLabel(label))
      units.push({ kind: 'code-label', content: label, context: context(containers, 'filename'), position: blockPosition(), target: { type: 'attr', attrs, key: 'filename' } })
    const element = children(node).find(isElement)
    const language = String(attrs.language ?? '')
    const firstLine = language ? fences[fenceIndex++] : undefined
    if (!policy.codeComments || !element || !language)
      return
    for (const comment of findComments(elementText(element), language)) {
      const commentLine = firstLine === undefined ? undefined : firstLine + comment.line
      units.push({
        kind: 'code-comment',
        content: comment,
        language,
        context: context(containers, language),
        position: commentLine === undefined ? blockPosition() : { startLine: commentLine, endLine: commentLine, precision: 'node' },
        target: { type: 'code', element, comment },
      })
    }
  }

  function visitMixed(parent: Node[], start: number, containers: string[], synced: boolean, kind?: SegmentKind) {
    let runStart = -1
    const flush = (end: number) => {
      if (runStart >= 0)
        pushInline(kind ?? kindForContainers(containers, policy), parent, runStart, end, containers)
      runStart = -1
    }
    for (let i = start; i < parent.length; i++) {
      if (isInlineAt(parent, i, start)) {
        if (runStart < 0)
          runStart = i
      }
      else {
        flush(i)
        visitBlock(parent[i]!, containers, synced)
      }
    }
    flush(parent.length)
  }

  function visitBlock(node: Node, containers: string[], synced: boolean) {
    if (!isElement(node))
      return
    const [tag, attrs] = node
    const container = node as unknown as Node[]
    if (UNTRANSLATABLE.has(tag)) {
      if (tag === 'pre')
        pushCode(node, containers, synced)
      return
    }
    if (HEADINGS.has(tag)) {
      const level = Number(tag[1])
      pushInline('heading', container, 2, node.length, containers, tag)
      trail = Array.from({ length: level }, (_, i) => i < level - 1 ? (trail[i] ?? '') : elementText(node))
      return
    }
    if (tag === 'p')
      return visitMixed(container, 2, containers, synced)
    if (tag === 'th' || tag === 'td')
      return pushInline('table-cell', container, 2, node.length, containers, tag)
    if (TABLE_PARTS.has(tag) || LISTS.has(tag)) {
      const inner = tag === 'table' ? [...containers, 'table'] : containers
      for (const child of children(node))
        visitBlock(child, inner, synced)
      return
    }
    const name = tag === 'template' ? `${containers.at(-1) ?? ''}#${attrs.name ?? 'default'}` : tag
    const inner = tag === 'template' ? [...containers.slice(0, -1), name] : [...containers, name]
    if (tag !== 'template' && tag !== 'li' && tag !== 'blockquote')
      pushProps(node, inner)
    if (policy.opaque.includes(tag)) {
      fenceIndex += countLanguageFences(node)
      return
    }
    visitMixed(container, 2, inner, synced || (tag === 'code-group' && attrs.sync !== undefined), policy.htmlText.includes(tag) ? 'html-block' : undefined)
  }

  doc.nodes.forEach((node, i) => {
    line = doc.lines?.[i] ?? line
    slicer = sourceLines ? new SourceSlicer(sourceLines.slice(line[0] - 1, line[1]).join('\n')) : undefined
    fences = sourceLines ? fenceStarts(sourceLines, line) : []
    fenceIndex = 0
    if (isInline(node))
      pushInline('paragraph', doc.nodes, i, i + 1, [])
    else
      visitBlock(node, [], false)
  })
  return units
}

function countLanguageFences(node: ElementNode): number {
  let count = 0
  for (const child of children(node)) {
    if (!isElement(child))
      continue
    if (child[0] === 'pre')
      count += child[1].language ? 1 : 0
    else
      count += countLanguageFences(child)
  }
  return count
}

function findImages(nodes: Node[]): ElementNode[] {
  const found: ElementNode[] = []
  const visit = (node: Node) => {
    if (!isElement(node))
      return
    if (node[0] === 'img')
      found.push(node)
    children(node).forEach(visit)
  }
  nodes.forEach(visit)
  return found
}

/** First content lines of the fences between `start` and `end` whose info string sets a language. */
function fenceStarts(lines: string[], [start, end]: [number, number]): number[] {
  const starts: number[] = []
  let fence = ''
  for (let i = start - 1; i < end; i++) {
    const [opening, marker] = /^\s*(`{3,}|~{3,})/.exec(lines[i] ?? '') ?? []
    if (!marker)
      continue
    if (!fence) {
      fence = marker
      if (/^[^[{]/.test(lines[i]!.slice(opening!.length).trim()))
        starts.push(i + 2)
    }
    else if (marker[0] === fence[0] && marker.length >= fence.length && /^\s*[`~]+\s*$/.test(lines[i]!)) {
      fence = ''
    }
  }
  return starts
}
