import type { ApplyReport, PolicySnapshot, TranslationRecord } from '@diglot/core'
import { isPlatformBrowser, isPlatformServer } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import { ApplicationRef, inject, Injectable, makeStateKey, PLATFORM_ID, TransferState } from '@angular/core'
import { restorePolicy } from '@diglot/core'
import { parseBundle } from '@diglot/store/runtime'
import { firstValueFrom } from 'rxjs'
import snapshot from '../../translations/.diglot/policy.json'
import { defaultLocale } from './locales'

export interface DocumentRequest {
  locale: string
  path: string
}

export interface TranslatedDocument {
  markdown: string
  report: ApplyReport | null
}

const policy = restorePolicy(snapshot as PolicySnapshot)

@Injectable({ providedIn: 'root' })
export class DiglotStore {
  private readonly http = inject(HttpClient)
  private readonly transferState = inject(TransferState)
  private readonly server = isPlatformServer(inject(PLATFORM_ID))
  private readonly bundles = new Map<string, Promise<ReadonlyMap<string, TranslationRecord>>>()
  private hydrating = isPlatformBrowser(inject(PLATFORM_ID))

  constructor() {
    if (this.hydrating)
      void inject(ApplicationRef).whenStable().then(() => this.hydrating = false)
  }

  transferred({ locale, path }: DocumentRequest): TranslatedDocument | undefined {
    return this.hydrating ? this.transferState.get(stateKey(locale, path), undefined) : undefined
  }

  async load({ locale, path }: DocumentRequest): Promise<TranslatedDocument> {
    const document = locale === defaultLocale
      ? { markdown: await this.fetchText(sourceUrl(path)), report: null }
      : await this.translate(locale, path)
    if (this.server)
      this.transferState.set(stateKey(locale, path), document)
    return document
  }

  private async translate(locale: string, path: string): Promise<TranslatedDocument> {
    const [source, records, { apply }] = await Promise.all([
      this.fetchText(sourceUrl(path)),
      this.bundle(locale),
      import('@diglot/mdast'),
    ])
    const { markdown, report } = await apply(source, records, { policy, file: `src/content/docs/${path}.md` })
    return { markdown, report }
  }

  private bundle(locale: string): Promise<ReadonlyMap<string, TranslationRecord>> {
    let bundle = this.bundles.get(locale)
    if (!bundle) {
      bundle = this.fetchText(`/translations/${locale}.json`).then(parseBundle)
      bundle.catch(() => this.bundles.delete(locale))
      this.bundles.set(locale, bundle)
    }
    return bundle
  }

  private fetchText(url: string): Promise<string> {
    return firstValueFrom(this.http.get(url, { responseType: 'text', transferCache: false }))
  }
}

function sourceUrl(path: string): string {
  return `/docs/${path}.md`
}

function stateKey(locale: string, path: string) {
  return makeStateKey<TranslatedDocument>(`diglot:${locale}:${path}`)
}
