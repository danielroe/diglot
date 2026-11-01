/**
 * Parser-neutral inline representation. Adapters convert their AST into this;
 * everything in `core/` works on it and never sees the parser's own nodes.
 */
export type InlineNode =
  | { type: 'text', value: string }
  | { type: 'strong' | 'emphasis' | 'delete', children: InlineNode[] }
  /** `open` / `close` are the markdown around the link text, e.g. `[` and `](/url)`. */
  | { type: 'link', children: InlineNode[], open: string, close: string }
  /** A protected span; `source` is its markdown. */
  | { type: 'atomic', kind: PlaceholderType, source: string, name?: string, hidesText?: boolean }
  | { type: 'break' }

export type PlaceholderType = 'code' | 'link' | 'component' | 'html' | 'image' | 'break' | 'binding' | 'other'

export interface Placeholder {
  id: number
  type: PlaceholderType
  /** Atomic: markdown the placeholder stands for. Paired: markdown before the wrapped text. */
  source: string
  /** Paired placeholders only: markdown after the wrapped text. */
  close?: string
  /** Component or HTML tag name, for `component` / `html` placeholders. */
  name?: string
  /** The protected span contains letters (e.g. `:badge[once]`) that stay untranslated. */
  hidesText?: boolean
}

export type SegmentKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'table-cell'
  | 'blockquote'
  | 'component-slot'
  | 'html-block'
  | 'image-alt'
  | 'prop'
  | 'code-label'
  | 'frontmatter'
  | 'navigation'

export interface SegmentContext {
  file: string
  /** Text of the enclosing headings, outermost first. */
  headingTrail: string[]
  /** Ordinal of the segment within the file. */
  index: number
  /** Enclosing container path, e.g. `['steps', 'callout']` or `['card#title']`. */
  containers: string[]
  /** Heading tag, prop name or frontmatter key, depending on `kind`. */
  detail?: string
}

export interface SegmentPosition {
  startLine: number
  endLine: number
  /** `block`: line range of the enclosing top-level block. `file`: no position (frontmatter, yaml). */
  precision: 'block' | 'file'
}

/** What an adapter hands to the core for each translatable unit. */
export interface SegmentDraft {
  kind: SegmentKind
  /** Inline content for markdown units, a plain string for props / frontmatter / yaml values. */
  content: InlineNode[] | string
  context: Omit<SegmentContext, 'index' | 'file'>
  position: SegmentPosition
}

export interface Segment {
  /** Identity: sha256 of `skeleton`, truncated. Ignores protected span contents. */
  hash: string
  /** sha256 of `text`, truncated. Changes when any protected span changes too. */
  sourceHash: string
  kind: SegmentKind
  format: 'markdown' | 'plain'
  /** Placeholder form shown to translators / MT. */
  skeleton: string
  /** Canonical markdown: `skeleton` with placeholders re-injected. */
  text: string
  placeholders: Placeholder[]
  /** Word count of the skeleton outside placeholders. */
  words: number
  context: SegmentContext
  position: SegmentPosition
}
