import type { Glossary, GlossaryEntry, LocaleStyle } from '@diglot/core'
import type { PageContext, QaIssue } from './types.ts'

/** Recorded in `mt.promptVersion`; bump when prompts change in a way that affects output. */
export const PROMPT_VERSION = '1'

const languages = new Intl.DisplayNames(['en'], { type: 'language' })

function languageName(locale: string): string {
  try {
    return languages.of(locale) ?? locale
  }
  catch {
    return locale
  }
}

export interface PromptOptions {
  locale: string
  sourceLocale?: string
  subject?: string
  glossary?: Glossary
  style?: LocaleStyle
}

const TOKEN_RULES = [
  'Tokens such as {0} and {1} stand for code, links, components or HTML. Keep every token from the source, as many times as it appears there. You may move a token to fit the grammar, and you may repeat a code token when the grammar needs the referent repeated, but never translate, change, drop or invent a token.',
  'A pair such as {2}link text{/2} is a link. Translate the text between the tags and keep both tags around it.',
]

const MARKDOWN_RULES = [
  'Keep emphasis markers (**bold**, *italic*, ~~strikethrough~~) around the equivalent words. Do not add other markdown: no links, code spans, HTML, headings or list markers.',
  'A backslash before a punctuation character (\\*, \\_, \\[, \\<) keeps it literal. Keep these escapes, and put a backslash before any of ` * _ [ ] < { } ~ | that you add as literal text.',
  'Segments marked "plain" are plain text: no markdown and no backslash escapes.',
]

function styleRules(options: PromptOptions): string[] {
  return [...options.glossary?.style ?? [], ...options.style?.rules ?? []]
}

function numbered(rules: string[]): string[] {
  return rules.map((rule, i) => `${i + 1}. ${rule}`)
}

function glossaryLines(entries: GlossaryEntry[]): string[] {
  return entries.map((entry) => {
    const note = entry.note ? ` (${entry.note})` : ''
    if (entry.decision === 'keep')
      return `- "${entry.term}"${note}: keep in English, do not translate or transliterate`
    if (entry.decision === 'keep-gloss')
      return `- "${entry.term}"${note}: keep in English; on its first use in a page add the gloss in parentheses: "${entry.term} (${entry.gloss})"`
    if (entry.target)
      return `- "${entry.term}"${note}: translate as "${entry.target}"`
    return `- "${entry.term}"${note}: translate according to this meaning`
  })
}

export function translateSystemPrompt(options: PromptOptions, terms: GlossaryEntry[]): string {
  const target = languageName(options.locale)
  const parts = [
    `You translate ${options.subject ?? 'technical documentation'} from ${languageName(options.sourceLocale ?? 'en')} into ${target}. Your output is a first draft that a human translator will review, so be accurate and natural, and never add content that is not in the source.`,
    '',
    'Each segment is one unit of a page: a heading, paragraph, list item, table cell, callout, image description, component property, page metadata field or code comment. Rules:',
    ...numbered([
      ...TOKEN_RULES,
      ...MARKDOWN_RULES,
      'Keep numbers and version strings as in the source. Each segment stays on a single line.',
      'Output only the translation of each segment, with no notes, quotes or explanations.',
      ...styleRules(options),
    ]),
  ]
  if (terms.length)
    parts.push('', 'Terminology (apply these decisions consistently):', ...glossaryLines(terms))
  parts.push('', 'Respond with JSON: {"translations": [{"id": "<same id as input>", "text": "<translation>"}]}, one entry per input segment, same ids, same order.')
  return parts.join('\n')
}

export interface PromptSegment {
  id: string
  kind: string
  format?: 'plain'
  text: string
}

function contextLines(context?: PageContext): string[] {
  if (!context?.title && !context?.path)
    return []
  return [
    'Context (read-only, do not translate):',
    ...(context.title ? [`- Page title: ${context.title}`] : []),
    ...(context.path ? [`- Page: ${context.path}`] : []),
    '',
  ]
}

export function translateUserPrompt(segments: PromptSegment[], context?: PageContext): string {
  return [
    ...contextLines(context),
    segments.length === 1 ? 'Translate this segment:' : `Translate these ${segments.length} segments:`,
    JSON.stringify(segments, null, 1),
  ].join('\n')
}

export interface RetrySegment extends PromptSegment {
  previous?: string
  issues: QaIssue[]
}

export function retryUserPrompt(segments: RetrySegment[], context?: PageContext): string {
  const payload = segments.map(({ issues, ...s }) => ({ ...s, problems: issues.filter(i => i.severity === 'error').map(i => i.message) }))
  return [
    ...contextLines(context),
    `Your previous translations of these ${segments.length === 1 ? 'segment' : `${segments.length} segments`} failed automatic checks. Translate them again from the source and fix the problems:`,
    JSON.stringify(payload, null, 1),
  ].join('\n')
}

export function updateSystemPrompt(options: PromptOptions, terms: GlossaryEntry[]): string {
  const parts = [
    `You maintain the ${languageName(options.locale)} translation of ${options.subject ?? 'technical documentation'}. A human translator wrote the current translation. The ${languageName(options.sourceLocale ?? 'en')} source has since changed.`,
    '',
    'Update the translation so that it matches the new source, changing as little as possible:',
    ...numbered([
      'Sentences whose source did not change must be copied character for character from the current translation, even if you would phrase them differently.',
      'Only rewrite the words or sentences affected by the change. Match the tone, register and terminology of the current translation.',
      'Tokens such as {0} and {1} stand for code, links or components, and {2}text{/2} is a link around translatable text. Keep every token of the new source, as many times as it appears there; drop tokens that are no longer in the source and never invent tokens.',
      'Keep emphasis markers and backslash escapes. Do not add other markdown. The translation stays on a single line.',
    ]),
  ]
  const style = styleRules(options)
  if (style.length)
    parts.push('', 'Style for new wording:', ...style.map(rule => `- ${rule}`))
  if (terms.length)
    parts.push('', 'Terminology for new wording (do not change existing sentences to apply it):', ...glossaryLines(terms))
  parts.push('', 'Respond with JSON: {"text": "<updated translation>"}.')
  return parts.join('\n')
}

export interface UpdatePromptInput {
  wordDiff: string
  nextSource: string
  previousTranslation: string
  previousOutput?: string
  issues?: QaIssue[]
}

export function updateUserPrompt(input: UpdatePromptInput): string {
  const parts = [
    'The source changed as follows (word diff, [-removed-] {+added+}):',
    input.wordDiff,
    '',
    'New source:',
    input.nextSource,
    '',
    'Current translation (of the old source):',
    input.previousTranslation,
  ]
  if (input.previousOutput !== undefined) {
    parts.push('', 'Your previous update failed automatic checks:', input.previousOutput, '', 'Problems:', ...(input.issues ?? []).filter(i => i.severity === 'error').map(i => `- ${i.message}`))
  }
  return parts.join('\n')
}
