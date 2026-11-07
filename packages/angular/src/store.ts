import type { TranslationRecord } from '@diglot/core'
import type { TranslatedDocument } from './translate.ts'
import { isPlatformServer } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import { ApplicationRef, inject, InjectionToken, makeStateKey, PLATFORM_ID, TransferState } from '@angular/core'
import { parseBundle } from '@diglot/store/runtime'
import { DIGLOT_CONFIG } from './tokens.ts'
import { translateMarkdown } from './translate.ts'

export interface DocumentRequest {
  locale: string
  path: string
}

/** Loads documents and caches each locale's bundle for the lifetime of the application. */
export class DiglotStore {
  private readonly config = inject(DIGLOT_CONFIG)
  private readonly http = inject(HttpClient)
  private readonly transferState = inject(TransferState)
  private readonly server = isPlatformServer(inject(PLATFORM_ID))
  private readonly bundles = new Map<string, Promise<ReadonlyMap<string, TranslationRecord>>>()
  private hydrating = !this.server

  constructor() {
    if (this.hydrating)
      void inject(ApplicationRef).whenStable().then(() => this.hydrating = false)
  }

  /**
   * A document rendered on the server, so that the browser shows it without loading it again.
   * Once the application is stable, documents are loaded instead, so that they are never older
   * than the ones the browser loaded since.
   */
  transferred({ locale, path }: DocumentRequest): TranslatedDocument | undefined {
    if (!this.hydrating)
      return undefined
    return this.transferState.get(stateKey(locale, path), undefined)
  }

  async load(request: DocumentRequest, signal?: AbortSignal): Promise<TranslatedDocument> {
    const { locale, path } = request
    const config = this.config
    const document = locale === config.defaultLocale
      ? { markdown: await this.get(config.sourceUrl(path), signal), report: null }
      : await Promise.all([this.get(config.sourceUrl(path), signal), this.bundle(locale)])
          .then(([source, records]) => translateMarkdown(source, records, { parser: config.parser, policy: config.policy, file: path }))
    if (this.server)
      this.transferState.set(stateKey(locale, path), document)
    return document
  }

  /** The records of `locale`, fetched once and shared by every document. */
  bundle(locale: string): Promise<ReadonlyMap<string, TranslationRecord>> {
    let bundle = this.bundles.get(locale)
    if (!bundle) {
      bundle = this.get(this.config.bundleUrl(locale)).then(parseBundle)
      bundle.catch(() => {
        if (this.bundles.get(locale) === bundle)
          this.bundles.delete(locale)
      })
      this.bundles.set(locale, bundle)
    }
    return bundle
  }

  /**
   * Fetches text with `HttpClient`, so that interceptors and the server's URL handling apply.
   * Responses stay out of the HTTP transfer cache: bundles hold every page of a locale, and the
   * translated document is transferred instead.
   */
  private get(url: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted)
        return reject(signal.reason)
      const subscription = this.http.get(url, { responseType: 'text', transferCache: false }).subscribe({
        next: resolve,
        error: (error: Error) => reject(new Error(`\`diglotDocument()\` cannot fetch ${url}: ${error.message}`, { cause: error })),
      })
      signal?.addEventListener('abort', () => {
        subscription.unsubscribe()
        reject(signal.reason)
      }, { once: true })
    })
  }
}

export const DIGLOT_STORE: InjectionToken<DiglotStore> = new InjectionToken<DiglotStore>('DIGLOT_STORE')

function stateKey(locale: string, path: string) {
  return makeStateKey<TranslatedDocument>(`diglot:${locale}:${path}`)
}
