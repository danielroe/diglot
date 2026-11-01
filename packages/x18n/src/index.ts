import type { Glossary } from '@diglot/core'
import type { GlossaryEntry, Plugin } from '@x18n/core'
import { join, relative, resolve } from 'pathe'
import { reviewCheck, unusedCheck, validateCheck } from './checks.ts'
import { recordFinder } from './finder.ts'
import { MANIFEST_FORMAT, manifestFormat, RECORD_FORMAT, recordFormat } from './format.ts'
import { recordHistory } from './history.ts'
import { skeletonSyntax } from './placeholders.ts'
import { createRecordIndex } from './records.ts'
import { markdownScanner, sourceGlobs } from './scanner.ts'
import { createState, loadState } from './state.ts'

export { MANIFEST_FORMAT, RECORD_FORMAT } from './format.ts'
export { skeletonSyntax } from './placeholders.ts'
export { applyReviews, reviewRecord } from './reviews.ts'

declare module '@x18n/core' {
  interface CheckIds {
    'diglot-validate': true
    'diglot-review': true
    'diglot-unused': true
  }
}

export interface DiglotPluginOptions {
  /** Translations repository, relative to the x18n project root. Defaults to the project root. */
  root?: string
  /** Locale of the source documents. Defaults to `en`. */
  sourceLocale?: string
}

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

const GRAMMAR = [
  'Each message is one markdown unit in skeleton form. `{n}` stands for code, a component, an image or HTML; `{n}...{/n}` wraps the text of a link.',
  'Keep every placeholder of the source exactly once. Placeholders may move, and paired ones must stay paired and nested.',
  'Do not add markdown links, inline code, HTML, components or `{{ }}` bindings. `**` and `*` emphasis may be added or removed but must be balanced.',
  'Keep headings, table cells and other single-line units on one line.',
]

/** An x18n plugin that reads a diglot store: hashes are keys, source manifests hold the source locale, record files hold translations, and source documents are usages. */
export default function diglot(options: DiglotPluginOptions = {}): Plugin {
  const state = createState()
  const index = createRecordIndex()
  let sourceLocale = options.sourceLocale ?? 'en'
  return {
    name: 'diglot',
    runtime: 'node',
    async config(draft, ctx) {
      const root = resolve(ctx.host.root, options.root ?? '.')
      const prefix = relative(ctx.host.root, root)
      state.prefix = prefix
      const config = await loadState(state, root)
      sourceLocale = options.sourceLocale ?? draft.sourceLocale ?? sourceLocale
      draft.sourceLocale = sourceLocale
      draft.locales = [sourceLocale, ...config.locales]
      draft.keyStyle = 'flat'
      draft.resources = [
        ...state.manifests.map(path => ({ pattern: join(prefix, path), locale: sourceLocale, format: MANIFEST_FORMAT })),
        { pattern: join(prefix, '{locale}/segments/*/*.json'), format: RECORD_FORMAT },
      ]
      draft.usage = { ...draft.usage, include: sourceGlobs(config.sources).map(glob => join(prefix, glob)) }
      if (draft.history !== false)
        draft.history = { ...draft.history, git: false } as typeof draft.history
      draft.glossary = [...draft.glossary, ...glossaryEntries(state.glossaries)]
      draft.checks = { 'missing-translation': 'off', 'unused-key': 'off', ...state.manifests.length > 1 ? { 'key-conflict': 'off' } : {}, ...draft.checks }
    },
    localeFinders: [recordFinder(state)],
    formats: [manifestFormat(), recordFormat(state)],
    scanners: [markdownScanner(state)],
    placeholders: [skeletonSyntax],
    checks: [validateCheck(index), reviewCheck(index), unusedCheck(index)],
    histories: [recordHistory(() => sourceLocale)],
    translatePrompt(draft, ctx) {
      draft.rules.push(...GRAMMAR)
      draft.notes.push(...state.styles.get(ctx.targetLocale)?.rules ?? [], ...state.glossaries.get(ctx.targetLocale)?.style ?? [])
    },
  }
}
