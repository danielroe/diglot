import type { DocumentRequest, TranslatedDocument } from './diglot-store'
import { computed, inject, linkedSignal, resource } from '@angular/core'
import { DiglotStore } from './diglot-store'
import { DIGLOT_LOCALE } from './language'

interface Shown {
  request: DocumentRequest
  document: TranslatedDocument
}

export function diglotDocument(path: () => string) {
  const store = inject(DiglotStore)
  const locale = inject(DIGLOT_LOCALE)
  const request = computed<DocumentRequest>(() => ({ locale: locale(), path: path() }), {
    equal: (a, b) => a.locale === b.locale && a.path === b.path,
  })
  const transferred = computed(() => store.transferred(request()))
  const loaded = resource({
    params: () => transferred() ? undefined : request(),
    loader: ({ params }) => store.load(params).then((document): Shown => ({ request: params, document })),
  })
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
    reload: () => loaded.reload(),
  }
}
