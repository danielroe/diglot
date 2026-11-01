export type GlossaryDecision
  = | { decision: 'keep' }
    | {
      decision: 'translate'
      target: string
      /** Regular expression sources that also count as following the entry. */
      accept?: string[]
    }
    | { decision: 'keep-gloss', gloss: string }

/** One term of a per-locale glossary. */
export type GlossaryEntry = GlossaryDecision & {
  term: string
  /** Regular expression source matched case-insensitively against source skeletons. Defaults to the term as a whole word. */
  match?: string
  note?: string
}

/** Terminology and style rules for one locale, as stored in `<locale>/glossary.yml`. */
export interface Glossary {
  terms: GlossaryEntry[]
  /** Free-form style rules for translators and MT prompts. */
  style?: string[]
}

/** Glossary entries whose term occurs in a source skeleton, outside placeholders. */
export function matchGlossary(glossary: Glossary, skeleton: string): GlossaryEntry[] {
  const text = skeleton.replace(/\{\/?\d+\}/g, ' ')
  return glossary.terms.filter(entry => termPattern(entry).test(text))
}

function termPattern(entry: GlossaryEntry): RegExp {
  return new RegExp(entry.match ?? `\\b${entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu')
}
