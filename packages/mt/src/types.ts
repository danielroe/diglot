import type { Glossary, LocaleStyle, MachineTranslation, Placeholder, Segment, SegmentContext } from '@diglot/core'
import type { LanguageModel } from 'ai'

/** The parts of a segment that machine translation reads. */
export type MtSegment = Pick<Segment, 'hash' | 'kind' | 'format' | 'skeleton' | 'placeholders'> & {
  context?: Partial<Pick<SegmentContext, 'file' | 'headingTrail' | 'detail'>>
}

/** A source skeleton with as much placeholder information as is known. */
export interface SourceLike {
  skeleton: string
  placeholders?: Array<Pick<Placeholder, 'type'> & Partial<Pick<Placeholder, 'source' | 'close'>>>
}

/** Read-only context sent with the segments of one page. */
export interface PageContext {
  title?: string
  path?: string
}

export type QaCheck
  = | 'grammar'
    | 'placeholders'
    | 'untranslated'
    | 'length-ratio'
    | 'leaked-instructions'
    | 'structure'
    | 'numbers'
    | 'emphasis'
    | 'glossary'
    | 'response'

export interface QaIssue {
  check: QaCheck
  severity: 'error' | 'warning'
  message: string
}

/** Requests, tokens and cost of one or more model calls. */
export interface Usage {
  requests: number
  inputTokens: number
  outputTokens: number
  /** USD, from the provider's metadata or from `pricing`. Absent when neither is available. */
  costUsd?: number
}

/** USD per million tokens, used when the provider does not report a cost. */
export interface Pricing {
  input: number
  output: number
}

export interface MtOptions {
  /** Target locale, for example `fr`. */
  locale: string
  /** A model instance or a model id for the default provider. Defaults to `DIGLOT_MT_MODEL`. */
  model?: LanguageModel
  glossary?: Glossary
  style?: LocaleStyle
  /** What is being translated, for the system prompt. Defaults to `technical documentation`. */
  subject?: string
  /** Defaults to `en`. */
  sourceLocale?: string
  /** Retries for segments that fail an error-level QA check. Defaults to `1`. */
  qaRetries?: number
  pricing?: Pricing
  signal?: AbortSignal
}

export interface TranslateSegmentsOptions extends MtOptions {
  /** Page context, or a function returning it for a segment's file. */
  context?: PageContext | ((file: string | undefined) => PageContext | undefined)
  /** Segments per request: `page` sends each file's segments together (up to `maxBatch`). Defaults to `page`. */
  batch?: 'page' | number
  /** Upper bound on segments per request in `page` mode. Defaults to `40`. */
  maxBatch?: number
  /** Requests in flight. Defaults to `4`. */
  concurrency?: number
}

export interface SegmentTranslation {
  hash: string
  /** The translated skeleton. */
  text: string
  derived: 'fresh'
  /** Warning-level QA issues. */
  issues: QaIssue[]
  mt: MachineTranslation
}

export interface RejectedSegment {
  hash: string
  /** The last model output, when there was one. */
  output?: string
  issues: QaIssue[]
}

export interface TranslateSegmentsResult {
  translations: SegmentTranslation[]
  /** Segments that still failed an error-level check after the retries. */
  rejected: RejectedSegment[]
  usage: Usage
}

export interface UpdateSources {
  /** The source the previous translation was made from. */
  previousSource: string | SourceLike
  nextSource: MtSegment
}

export type UpdateTranslationResult
  = | {
    status: 'ok'
    /** The translated skeleton for `nextSource`. */
    text: string
    /** `carry`: the skeletons are identical and the previous text was reused without a model call. */
    derived: 'carry' | 'update'
    /** Sentences of `text` that are not in the previous translation. */
    changedSentences: string[]
    issues: QaIssue[]
    mt?: MachineTranslation
    usage: Usage
  }
  | {
    status: 'rejected'
    output?: string
    issues: QaIssue[]
    usage: Usage
  }
