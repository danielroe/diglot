import type { LanguageModel } from 'ai'
import type { QaIssue } from './qa.ts'

export type Locale = string

export type SegmentKind =
  | 'title'
  | 'description'
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'table-cell'
  | 'image-alt'
  | 'component-prop'
  | 'callout'

/** A translatable block produced by the segmenter. */
export interface SourceSegment {
  /** Stable id assigned by the segmenter; survives edits to surrounding blocks. */
  id: string
  kind: SegmentKind
  /** Markdown source of the block, without block-level syntax (`##`, `- `, `::note`). */
  text: string
  /** Heading trail from the page root to this segment. */
  headingTrail?: string[]
}

export interface Page {
  path: string
  title: string
  segments: SourceSegment[]
}

export type GlossaryDecision =
  | { decision: 'keep' }
  | { decision: 'translate', target: string, accept?: string[] }
  | { decision: 'keep-gloss', gloss: string }

export interface GlossaryEntry {
  term: string
  /** Case-insensitive pattern matched against the placeholder form of the source. */
  match: RegExp
  note?: string
  locales: Record<Locale, GlossaryDecision>
}

export type TranslationStatus =
  | 'machine'
  | 'machine-updated'
  | 'human'
  | 'verified'
  | 'stale'

export interface Provenance {
  status: TranslationStatus
  /** Hash of the placeholder form of the source this translation was made from. */
  sourceHash: string
  model?: string
  promptVersion?: string
  /** Hash of the translation this one was derived from by `updateTranslation`. */
  derivedFrom?: string
  createdAt: string
  qa: QaIssue[]
}

export interface Translation {
  segmentId: string
  locale: Locale
  text: string
  provenance: Provenance
}

export interface TranslateSegmentsOptions {
  locale: Locale
  glossary: GlossaryEntry[]
  /** Page metadata sent as read-only context. Segments of one page are batched together by default. */
  context?: { page: Pick<Page, 'path' | 'title'> }
  /** Segments per request. Defaults to `'page'`. */
  batch?: number | 'page'
  model?: LanguageModel
  /** Per-segment retries when a QA check with severity `error` fails. Defaults to 1. */
  qaRetries?: number
  signal?: AbortSignal
}

export interface TranslateSegmentsResult {
  translations: Translation[]
  /** Segments that still fail an `error` QA check after retries. They have no translation. */
  rejected: Array<{ segmentId: string, output: string, qa: QaIssue[] }>
  usage: { requests: number, inputTokens: number, outputTokens: number, costUsd?: number }
}

export declare function translateSegments (segments: SourceSegment[], options: TranslateSegmentsOptions): Promise<TranslateSegmentsResult>

export interface SourceDiff {
  /** Source text the previous translation was made from. */
  previous: string
  /** Current source text. */
  next: string
}

export interface UpdateTranslationOptions {
  glossary?: GlossaryEntry[]
  model?: LanguageModel
  signal?: AbortSignal
}

export interface UpdateTranslationResult {
  /**
   * `carry`: the placeholder form of the source is unchanged (only code, URLs or component props changed),
   * so the previous translation is reused with the new token values and no model call is made.
   * `model`: the model rewrote the parts affected by the change.
   */
  method: 'carry' | 'model'
  translation: Translation
  /** Target sentences that differ from the previous translation, for review UIs. */
  changedSentences: string[]
}

export declare function updateTranslation (previous: Translation, sourceDiff: SourceDiff, options?: UpdateTranslationOptions): Promise<UpdateTranslationResult>
