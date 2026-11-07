import type { ApplyReport, Policy, TranslationRecord } from '@diglot/core'

/** The parsers `@diglot/angular` can apply translations with. */
export type DiglotParser = 'comark' | 'mdast'

export interface TranslateOptions {
  parser: DiglotParser
  policy: Policy
  /** Path of the document, used for segment contexts and to read `.mdx` files as MDX with `mdast`. */
  file?: string
}

/** A document in the language it is shown in. */
export interface TranslatedDocument {
  /** The Markdown to render: the translation where one applies, and the source text elsewhere. */
  markdown: string
  /** What was applied. `null` for the default locale, which is shown as it is. */
  report: ApplyReport | null
}

/** Returns `parser` when this package can apply translations with it, and throws otherwise. */
export function resolveParser(parser: unknown): DiglotParser {
  if (parser === 'comark' || parser === 'mdast')
    return parser
  if (parser === 'satteri')
    throw new Error('the `satteri` parser needs native bindings, which browsers cannot load. Extract with `comark` or `mdast` to use translations in an Angular app.')
  throw new Error(`unknown parser ${JSON.stringify(parser)}: use \`comark\` or \`mdast\`, the parser your translations repository extracts with.`)
}

/**
 * Applies the records of one locale to a Markdown document. Segments without a usable record
 * keep their source text, and `report` says how many were applied, missing or rejected.
 */
export async function translateMarkdown(source: string, records: ReadonlyMap<string, TranslationRecord>, options: TranslateOptions): Promise<TranslatedDocument> {
  const { policy, file } = options
  if (resolveParser(options.parser) === 'comark') {
    const { apply, parse, render } = await import('@diglot/comark')
    const { doc, report } = await apply(await parse(source), records, { policy, file, copy: false })
    return { markdown: await render(doc), report }
  }
  const { apply } = await import('@diglot/mdast')
  const { markdown, report } = await apply(source, records, { policy, file })
  return { markdown, report }
}
