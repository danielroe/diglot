import type { Signal } from '@angular/core'
import type { ApplyReport } from '@diglot/core'
import type { DocumentRequest } from './store.ts'
import type { TranslatedDocument } from './translate.ts'
import { assertInInjectionContext, computed, inject, linkedSignal, resource } from '@angular/core'
import { DIGLOT_STORE } from './store.ts'
import { DIGLOT_LOCALE } from './tokens.ts'

/** A document in the current locale. */
export interface DiglotDocument {
  /**
   * The locale of the document on screen. While the document of another locale loads, it stays
   * the locale of the previous document, so that it always matches `markdown`.
   */
  locale: Signal<string>
  /**
   * The Markdown to render, or `undefined` until the first document has loaded and after an
   * error. While another document loads, it keeps the previous one.
   */
  markdown: Signal<string | undefined>
  /**
   * What was applied to `markdown`: how many segments were translated, missing or rejected.
   * `null` for the default locale, and `undefined` when there is no `markdown`.
   */
  report: Signal<ApplyReport | null | undefined>
  isLoading: Signal<boolean>
  /** Why the source or the bundle could not be loaded or applied. */
  error: Signal<Error | undefined>
  /**
   * Loads the document again, even when the server rendered it. Bundles are kept, unless
   * loading one failed.
   */
  reload: () => void
}

/** A loaded document, with the request it answers. */
interface Shown {
  request: DocumentRequest
  document: TranslatedDocument
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
  // `reload()` skips the document the server rendered, until the request changes.
  const skipTransferred = linkedSignal({ source: request, computation: () => false })
  const transferred = computed(() => skipTransferred() ? undefined : store.transferred(request()))
  const loaded = resource({
    params: () => transferred() ? undefined : request(),
    loader: ({ params, abortSignal }) => store.load(params, abortSignal).then((document): Shown => ({ request: params, document })),
  })
  // The current document, the previous one while the next loads, and none after an error.
  const shown = linkedSignal<{ next: Shown | undefined, failed: boolean }, Shown | undefined>({
    source: () => {
      const document = transferred()
      return {
        next: document ? { request: request(), document } : loaded.hasValue() ? loaded.value() : undefined,
        failed: loaded.error() !== undefined,
      }
    },
    computation: ({ next, failed }, previous) => next ?? (failed ? undefined : previous?.value),
  })
  return {
    locale: computed(() => shown()?.request.locale ?? request().locale),
    markdown: computed(() => shown()?.document.markdown),
    report: computed(() => shown()?.document.report),
    isLoading: loaded.isLoading,
    error: computed(() => loaded.error()),
    reload: () => {
      if (transferred())
        skipTransferred.set(true)
      else
        loaded.reload()
    },
  }
}
