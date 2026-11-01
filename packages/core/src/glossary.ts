export type GlossaryDecision
  = | { decision: 'keep' }
    | {
      decision: 'translate'
      /** Required translation. Without it the term is translated freely, guided by `note`. */
      target?: string
      /** Regular expression sources that also count as following the entry. */
      accept?: string[]
    }
    | { decision: 'keep-gloss', gloss: string }

/** One term of a per-locale glossary. */
export type GlossaryEntry = GlossaryDecision & {
  term: string
  /** Regular expression source matched against source skeletons. Defaults to the term as a whole word. */
  match?: string
  /** Match `term` or `match` case-sensitively. Defaults to `false`. */
  caseSensitive?: boolean
  note?: string
}

/** Terminology and style rules for one locale, as stored in `<locale>/glossary.yml`. */
export interface Glossary {
  terms: GlossaryEntry[]
  /** Free-form style rules for translators and MT prompts. */
  style?: string[]
}

/** Style rules for one locale, as stored in `<locale>/style.yml`. */
export interface LocaleStyle {
  /** Free-form rules for translators and MT prompts. */
  rules?: string[]
  typography?: {
    /** Characters preceded by a narrow no-break space (U+202F), for example `;:!?»` in French. */
    spaceBefore?: string
    /** Characters followed by a narrow no-break space (U+202F), for example `«` in French. */
    spaceAfter?: string
  }
  /** Expected range of translated to source length (characters outside placeholders). */
  lengthRatio?: [number, number]
}

/** Glossary entries whose term occurs in a source skeleton, outside placeholders. */
export function matchGlossary(glossary: Glossary, skeleton: string): GlossaryEntry[] {
  const text = skeleton.replace(/\{\/?\d+\}/g, ' ')
  return glossary.terms.filter(entry => termPattern(entry).test(text))
}

/** The pattern that finds a glossary entry's term in text. */
export function termPattern(entry: Pick<GlossaryEntry, 'term' | 'match' | 'caseSensitive'>): RegExp {
  return new RegExp(entry.match ?? `\\b${entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, entry.caseSensitive ? 'u' : 'iu')
}
