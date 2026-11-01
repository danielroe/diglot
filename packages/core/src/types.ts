/**
 * Parser-neutral inline representation. Adapters convert their AST into this; the core never
 * sees parser nodes. `data` is carried through untouched so an adapter can map placeholders
 * back to its own nodes.
 */
export type InlineNode
  = | TextNode
    | EmphasisNode
    | LinkNode
    | AtomicNode

export interface TextNode {
  type: 'text'
  value: string
}

export interface EmphasisNode {
  type: 'strong' | 'emphasis' | 'delete'
  children: InlineNode[]
}

/** A link. `open` and `close` are the markdown around the link text, e.g. `[` and `](/url)`. */
export interface LinkNode {
  type: 'link'
  children: InlineNode[]
  open: string
  close: string
  data?: unknown
}

/** A protected span. `source` is the markdown it stands for. */
export interface AtomicNode {
  type: 'atomic'
  kind: PlaceholderType
  source: string
  name?: string
  hidesText?: boolean
  data?: unknown
}

export type PlaceholderType = 'code' | 'link' | 'component' | 'html' | 'image' | 'break' | 'binding' | 'other'

export interface Placeholder {
  id: number
  type: PlaceholderType
  /** Atomic placeholders: the markdown the placeholder stands for. Paired: the markdown before the wrapped text. */
  source: string
  /** Paired placeholders only: the markdown after the wrapped text. */
  close?: string
  /** Component or HTML tag name. */
  name?: string
  /** The protected span contains letters that stay untranslated (for example `:badge[once]`). */
  hidesText?: boolean
}

export type SegmentKind
  = | 'heading'
    | 'paragraph'
    | 'list-item'
    | 'table-cell'
    | 'blockquote'
    | 'component-slot'
    | 'html-block'
    | 'image-alt'
    | 'prop'
    | 'code-label'
    | 'code-comment'
    | 'frontmatter'
    | 'navigation'

/** `plain` segments (props, frontmatter, labels, code comments) are never parsed as markdown. */
export type SegmentFormat = 'markdown' | 'plain'

export interface SegmentContext {
  file: string
  /** Text of the enclosing headings, outermost first. */
  headingTrail: string[]
  /** Ordinal of the segment within its file. */
  index: number
  /** Enclosing container path, for example `['steps', 'callout']` or `['card#title']`. */
  containers: string[]
  /** Heading tag, prop name, frontmatter path or code language, depending on `kind`. */
  detail?: string
}

export interface SegmentPosition {
  startLine: number
  endLine: number
  /** `node`: exact lines of the unit. `block`: lines of the enclosing top-level block. `file`: no position. */
  precision: 'node' | 'block' | 'file'
}

/** What an adapter hands to the core for each translatable unit. */
export interface SegmentDraft {
  kind: SegmentKind
  /** Defaults to `plain` for string content and `markdown` otherwise. */
  format?: SegmentFormat
  /** Inline content, or a plain string. */
  content: InlineNode[] | string
  context: Omit<SegmentContext, 'index' | 'file'>
  position: SegmentPosition
}

export interface Segment {
  /** Identity: truncated sha256 of `skeleton` (and `salt`, when set). */
  hash: string
  /** Truncated sha256 of `text`. Changes when protected spans change too. */
  sourceHash: string
  kind: SegmentKind
  format: SegmentFormat
  /** Placeholder form: the only thing a translator or MT model sees. */
  skeleton: string
  /** `skeleton` with placeholders re-injected. */
  text: string
  placeholders: Placeholder[]
  /** Words outside placeholders. `0` means there is nothing to translate. */
  words: number
  context: SegmentContext
  position: SegmentPosition
  /** Context salt mixed into `hash` to separate ambiguous short strings. */
  salt?: string
}
