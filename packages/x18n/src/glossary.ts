import type { Glossary } from '@diglot/core'
import type { GlossaryEntry } from '@x18n/core'

/** Maps the per-locale diglot glossaries onto x18n glossary entries, one per term. */
export function glossaryEntries(glossaries: Map<string, Glossary>): GlossaryEntry[] {
  const entries = new Map<string, { term: string, translations?: Record<string, string>, note?: string, doNotTranslate?: boolean }>()
  for (const [locale, glossary] of glossaries) {
    for (const term of glossary.terms) {
      const entry = entries.get(term.term) ?? { term: term.term }
      entries.set(term.term, entry)
      if (term.decision === 'translate') {
        if (term.target !== undefined)
          entry.translations = { ...entry.translations, [locale]: term.target }
      }
      else {
        entry.doNotTranslate = true
      }
      const note = [term.note, term.decision === 'keep-gloss' ? `${locale}: keep, gloss as "${term.gloss}"` : undefined].filter(Boolean).join('; ')
      if (note)
        entry.note = entry.note ? `${entry.note}; ${note}` : note
    }
  }
  return [...entries.values()]
}
