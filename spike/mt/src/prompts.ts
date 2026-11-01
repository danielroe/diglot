import { glossaryPrompt, type Locale } from './glossary.ts'

export const LOCALE_NAMES: Record<Locale, string> = { fr: 'French', ja: 'Japanese' }

const STYLE: Record<Locale, string> = {
  fr: 'Address the reader as "vous". Use sentence case for headings (only the first word and proper nouns capitalised).',
  ja: 'Use the polite です/ます style for prose and a concise noun phrase for headings. Use Japanese punctuation (、。). Leave placeholders and English product names as they are; do not convert them to full-width characters.',
}

const STYLE_FINAL: Record<Locale, string> = {
  fr: STYLE.fr,
  ja: `${STYLE.ja} Use *asterisks* rather than _underscores_ for emphasis. Put a half-width space between a token and adjacent Japanese text.`,
}

const TOKEN_RULE_FINAL = '1. Tokens such as {0}, {1}, {2} stand for code, URLs, components or HTML. Keep every token from the source, as many times as it appears there. You may move a token to fit the grammar, and you may repeat a code token when the grammar needs the referent repeated, but never translate, change, drop or invent a token, and never repeat a link, HTML or component token.'

export interface SystemPromptOptions {
  locale: Locale
  glossary: boolean
  final?: boolean
}

export function systemPrompt ({ locale, glossary, final }: SystemPromptOptions): string {
  const lang = LOCALE_NAMES[locale]
  const parts = [
    `You translate the documentation of Nuxt, a Vue web framework, from English into ${lang}. Your output is a first draft that a human translator will review, so be accurate and natural, and never add content that is not in the source.`,
    '',
    'Each segment is one block of markdown (a paragraph, heading, list item, callout or page metadata). Rules:',
    '1. Tokens such as {0}, {1}, {2} stand for code, URLs, components or HTML. Copy every token from the source exactly once. You may move a token to fit the grammar, but never translate, change, duplicate, drop or invent a token.',
    '2. A link is written [link text]({n}). Translate the link text, keep the ({n}) right after the closing bracket.',
    '3. Keep inline markdown (**bold**, *italic*, _italic_) around the equivalent words. Do not add or remove markdown, headings markers or list markers.',
    '4. Keep numbers, version strings and line breaks as in the source.',
    '5. Output only the translation of each segment, with no notes, quotes or explanations.',
    `6. ${(final ? STYLE_FINAL : STYLE)[locale]}`,
  ]
  if (final) { parts[3] = TOKEN_RULE_FINAL }
  if (glossary) {
    parts.push('', 'Terminology (apply these decisions consistently):', glossaryPrompt(locale))
  }
  parts.push('', 'Respond with JSON: {"translations": [{"id": "<same id as input>", "text": "<translation>"}]}, one entry per input segment, same ids, same order.')
  return parts.join('\n')
}

export interface PromptSegment {
  id: string
  kind: string
  text: string
}

export interface PromptContext {
  pageTitle?: string
  headingTrail?: string[]
  previous?: string
  next?: string
}

export function userPrompt (segments: PromptSegment[], context?: PromptContext): string {
  const parts: string[] = []
  if (context && (context.pageTitle || context.headingTrail?.length || context.previous || context.next)) {
    parts.push('Context (read-only, do not translate):')
    if (context.pageTitle) { parts.push(`- Page title: ${context.pageTitle}`) }
    if (context.headingTrail?.length) { parts.push(`- Section: ${context.headingTrail.join(' > ')}`) }
    if (context.previous) { parts.push(`- Previous segment: ${JSON.stringify(context.previous)}`) }
    if (context.next) { parts.push(`- Next segment: ${JSON.stringify(context.next)}`) }
    parts.push('')
  }
  parts.push(segments.length === 1 ? 'Translate this segment:' : `Translate these ${segments.length} segments:`)
  parts.push(JSON.stringify(segments, null, 1))
  return parts.join('\n')
}

export function updateSystemPrompt (locale: Locale, glossary = false): string {
  const lang = LOCALE_NAMES[locale]
  const terms = glossary ? ['', 'Terminology for new wording (do not change existing sentences to apply it):', glossaryPrompt(locale)] : []
  return [
    `You maintain the ${lang} translation of the Nuxt documentation. A human translator wrote the current translation. The English source has since changed.`,
    '',
    'Update the translation so that it matches the new source, changing as little as possible:',
    '1. Sentences whose English source did not change must be copied character for character from the current translation, even if you would phrase them differently.',
    '2. Only rewrite the words or sentences affected by the change. Match the tone, register and terminology of the current translation.',
    '3. Tokens such as {0}, {1} stand for code, URLs or components. Keep every token of the new source, as many times as it appears there; never invent tokens.',
    '4. Keep markdown formatting and line breaks.',
    ...terms,
    '',
    'Respond with JSON: {"text": "<updated translation>"}.',
  ].join('\n')
}

export interface UpdatePromptInput {
  previousSource: string
  nextSource: string
  wordDiff: string
  previousTranslation: string
}

export function updateUserPrompt (input: UpdatePromptInput): string {
  return [
    'The source changed as follows (word diff, [-removed-] {+added+}):',
    input.wordDiff,
    '',
    'New source:',
    input.nextSource,
    '',
    'Current translation (of the old source):',
    input.previousTranslation,
  ].join('\n')
}
