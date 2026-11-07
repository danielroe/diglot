import type { Signal } from '@angular/core'
import type { ApplyReport } from '@diglot/core'
import type { DocumentRequest } from './store.ts'
import { assertInInjectionContext, computed, inject, resource } from '@angular/core'
import { DIGLOT_STORE } from './store.ts'
import { DIGLOT_LOCALE } from './tokens.ts'

/** A document in the current locale. */
export interface DiglotDocument {
  /** The locale the document is shown in. */
  locale: Signal<string>
  /** The Markdown to render, or `undefined` until it has loaded. */
  markdown: Signal<string | undefined>
  /**
   * What was applied: how many segments were translated, missing or rejected. `null` for the
   * default locale, and `undefined` until the document has loaded.
   */
  report: Signal<ApplyReport | null | undefined>
  isLoading: Signal<boolean>
  /** Why the source or the bundle could not be loaded or applied. */
  error: Signal<Error | undefined>
  /** Loads the document again. Bundles are kept, unless loading one failed. */
  reload: () => void
}

/**
 * Reads the document at `path` in the current locale. Call it in an injection context, such as a
 * component's field initialiser. The document loads again when `path` or the locale changes.
 */
export function diglotDocument(path: () => string): DiglotDocument {
  assertInInjectionContext(diglotDocument)
  const store = inject(DIGLOT_STORE)
  const locale = inject(DIGLOT_LOCALE)
  const request = computed<DocumentRequest>(() => ({ locale: locale(), path: path() }), { equal: (a, b) => a.locale === b.locale && a.path === b.path })
  const transferred = computed(() => store.transferred(request()))
  const loaded = resource({
    params: () => transferred() ? undefined : request(),
    loader: ({ params, abortSignal }) => store.load(params, abortSignal),
  })
  const document = computed(() => transferred() ?? (loaded.hasValue() ? loaded.value() : undefined))
  return {
    locale: computed(() => request().locale),
    markdown: computed(() => document()?.markdown),
    report: computed(() => document()?.report),
    isLoading: loaded.isLoading,
    error: computed(() => loaded.error()),
    reload: () => loaded.reload(),
  }
}
