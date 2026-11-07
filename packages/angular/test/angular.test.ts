/* eslint-disable perfectionist/sort-imports -- Angular's packages are partially compiled, so the JIT compiler must load before them. */
import '@angular/compiler'
import type { HttpEvent, HttpRequest } from '@angular/common/http'
import type { Routes } from '@angular/router'
import type { PolicySnapshot, TranslationRecord } from '@diglot/core'
import type { LocaleBundle } from '@diglot/store'
import type { DiglotOptions } from '../src/index.ts'
import { readFileSync } from 'node:fs'
import { HttpBackend, HttpErrorResponse, HttpResponse, provideHttpClient } from '@angular/common/http'
import { ApplicationRef, Component, makeStateKey, PLATFORM_ID, signal, TransferState } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { platformServerTesting, ServerTestingModule } from '@angular/platform-server/testing'
import { provideRouter, Router } from '@angular/router'
import { RouterTestingHarness } from '@angular/router/testing'
import { extract as extractComark, parse } from '@diglot/comark'
import { createRecord, restorePolicy, snapshotPolicy } from '@diglot/core'
import { extract as extractMdast } from '@diglot/mdast'
import { Observable } from 'rxjs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DIGLOT_LOCALE, diglotDocument, provideDiglot, resolveParser, translateMarkdown } from '../src/index.ts'
import { withDiglotRouteLocale } from '../src/router.ts'
/* eslint-enable perfectionist/sort-imports */

const docs = new URL('../../astro/test/fixtures/site/src/content/docs/en/', import.meta.url)
const sources: Record<string, string> = Object.fromEntries(['guide', 'index', 'untranslated'].map(name => [name, readFileSync(new URL(`${name}.md`, docs), 'utf8')]))
const policy = snapshotPolicy()
const french: Record<string, string> = {
  'Getting started': 'Bien démarrer',
  'Guide': 'Guide',
  'Welcome': 'Bienvenue',
  'Read the {0}guide{/0} to get started.': 'Lisez le {0}guide{/0} pour commencer.',
}

/** A bundle with a French record for each segment of the fixture pages that `french` translates. */
async function bundle(parser: 'comark' | 'mdast'): Promise<LocaleBundle> {
  const records: Record<string, TranslationRecord> = {}
  for (const [path, source] of Object.entries(sources)) {
    const segments = parser === 'comark' ? (await extractComark(await parse(source), { file: path })).segments : await extractMdast(source, { file: path })
    for (const segment of segments) {
      const text = french[segment.skeleton]
      if (text)
        records[segment.hash] = createRecord({ segment, text, origin: 'human', updatedAt: '2026-11-06T00:00:00.000Z' })
    }
  }
  return { version: 1, locale: 'fr', records }
}

/** Serves `files` by URL and records every request. */
class FakeBackend implements HttpBackend {
  readonly requests: string[] = []
  readonly files: Map<string, string>
  constructor(files: Map<string, string>) {
    this.files = files
  }

  handle(request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    this.requests.push(request.url)
    return new Observable((subscriber) => {
      const body = this.files.get(request.url)
      queueMicrotask(() => {
        if (body === undefined) {
          subscriber.error(new HttpErrorResponse({ status: 404, statusText: 'Not Found', url: request.url }))
        }
        else {
          subscriber.next(new HttpResponse({ body, status: 200, url: request.url }))
          subscriber.complete()
        }
      })
    })
  }
}

async function files(parser: 'comark' | 'mdast' = 'mdast') {
  return new Map([
    ...Object.entries(sources).map(([path, source]) => [`/docs/${path}.md`, source] as const),
    ['/translations/fr.json', JSON.stringify(await bundle(parser))],
  ])
}

function options(overrides: Partial<DiglotOptions> = {}): DiglotOptions {
  return {
    defaultLocale: 'en',
    bundleUrl: locale => `/translations/${locale}.json`,
    sourceUrl: path => `/docs/${path}.md`,
    policy,
    parser: 'mdast',
    ...overrides,
  }
}

function setup({ diglot = options(), platform = 'browser', features = [], routes = [], served }: { diglot?: DiglotOptions, platform?: 'browser' | 'server', features?: ReturnType<typeof withDiglotRouteLocale>[], routes?: Routes, served: Map<string, string> }) {
  const backend = new FakeBackend(served)
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      { provide: HttpBackend, useValue: backend },
      { provide: PLATFORM_ID, useValue: platform },
      provideRouter([...routes, { path: ':locale/:path', children: [] }, { path: '**', children: [] }]),
      provideDiglot(diglot, ...features),
    ],
  })
  return backend
}

function document(path: () => string) {
  return TestBed.runInInjectionContext(() => diglotDocument(path))
}

async function settle() {
  TestBed.tick()
  await TestBed.inject(ApplicationRef).whenStable()
}

beforeAll(() => {
  TestBed.initTestEnvironment(ServerTestingModule, platformServerTesting())
})

afterEach(() => {
  TestBed.resetTestingModule()
})

describe('translateMarkdown', () => {
  it.each(['mdast', 'comark'] as const)('should apply records with %s and report what applied', async (parser) => {
    const { records } = await bundle(parser)
    const { markdown, report } = await translateMarkdown(sources.guide!, new Map(Object.entries(records)), { parser, policy: restorePolicy(policy), file: 'guide' })
    expect(markdown).toContain('# Bien démarrer')
    expect(markdown).toContain('Install the package with `pnpm add example`.')
    expect(report).toMatchObject({ applied: 2, rejected: [] })
    expect(report!.missing).toBeGreaterThan(0)
  })

  it('should keep the source text where no record applies', async () => {
    const { markdown, report } = await translateMarkdown(sources.untranslated!, new Map(), { parser: 'mdast', policy: restorePolicy(policy) })
    expect(markdown).toBe(sources.untranslated)
    expect(report).toEqual({ applied: 0, missing: 2, rejected: [] })
  })
})

describe('resolveParser', () => {
  it('should refuse satteri and unknown parsers', () => {
    expect(resolveParser('comark')).toBe('comark')
    expect(() => resolveParser('satteri')).toThrow('native bindings')
    expect(() => resolveParser('remark')).toThrow('unknown parser "remark"')
  })
})

describe('provideDiglot', () => {
  it('should fail loudly without a usable policy', () => {
    expect(() => provideDiglot(options({ policy: undefined as unknown as PolicySnapshot }))).toThrow('`provideDiglot()` needs the `policy` option')
    expect(() => provideDiglot(options({ policy: { ...policy, fingerprint: 'nope' } }))).toThrow('cannot restore `policy`: the restored policy does not match')
    expect(() => provideDiglot(options({ policy: { ...policy, custom: ['salt'] } }))).toThrow('pass it to restorePolicy')
  })

  it('should refuse the satteri parser', () => {
    expect(() => provideDiglot(options({ parser: 'satteri' as 'mdast' }))).toThrow('native bindings')
  })
})

describe('diglotDocument', () => {
  it('should show the default locale as it is, without fetching a bundle', async () => {
    const backend = setup({ served: await files() })
    const doc = document(() => 'guide')
    await settle()
    expect(doc.markdown()).toBe(sources.guide)
    expect(doc.report()).toBeNull()
    expect(doc.locale()).toBe('en')
    expect(backend.requests).toEqual(['/docs/guide.md'])
  })

  it.each(['mdast', 'comark'] as const)('should translate documents with %s and fetch each bundle once', async (parser) => {
    const backend = setup({ diglot: options({ locale: () => 'fr', parser }), served: await files(parser) })
    const guide = document(() => 'guide')
    const index = document(() => 'index')
    TestBed.tick()
    expect(guide.isLoading()).toBe(true)
    await settle()
    expect(guide.markdown()).toContain('# Bien démarrer')
    expect(guide.report()).toMatchObject({ applied: 2 })
    expect(index.markdown()).toContain('Lisez le [guide](/en/guide/) pour commencer.')
    expect(backend.requests.filter(url => url.endsWith('.json'))).toEqual(['/translations/fr.json'])
  })

  it('should follow the locale and the path', async () => {
    const locale = signal('en')
    const path = signal('index')
    setup({ diglot: options({ locale }), served: await files() })
    const doc = document(path)
    await settle()
    expect(doc.markdown()).toContain('Welcome')
    locale.set('fr')
    await settle()
    expect(doc.markdown()).toContain('Bienvenue')
    path.set('untranslated')
    await settle()
    expect(doc.markdown()).toBe(sources.untranslated)
    expect(doc.report()).toEqual({ applied: 0, missing: 2, rejected: [] })
  })

  it('should report a missing bundle and fetch it again on reload', async () => {
    const served = await files()
    const bundle = served.get('/translations/fr.json')!
    served.delete('/translations/fr.json')
    const backend = setup({ diglot: options({ locale: () => 'fr' }), served })
    const doc = document(() => 'guide')
    await settle()
    expect(doc.error()?.message).toBe('`diglotDocument()` cannot fetch /translations/fr.json: Http failure response for /translations/fr.json: 404 Not Found')
    expect(doc.markdown()).toBeUndefined()
    served.set('/translations/fr.json', bundle)
    doc.reload()
    await settle()
    expect(doc.error()).toBeUndefined()
    expect(doc.markdown()).toContain('# Bien démarrer')
    expect(backend.requests.filter(url => url.endsWith('.json'))).toHaveLength(2)
  })

  it('should hand documents rendered on the server to the browser', async () => {
    setup({ diglot: options({ locale: () => 'fr' }), platform: 'server', served: await files() })
    const server = document(() => 'guide')
    await settle()
    const markdown = server.markdown()
    expect(markdown).toContain('# Bien démarrer')
    const state = TestBed.inject(TransferState).toJson()
    expect(JSON.parse(state)).toEqual({ 'diglot:fr:guide': { markdown, report: server.report() } })

    TestBed.resetTestingModule()
    const backend = setup({ diglot: options({ locale: () => 'fr' }), served: await files() })
    const transferred = TestBed.inject(TransferState)
    for (const [key, value] of Object.entries(JSON.parse(state)))
      transferred.set(key as never, value)
    const browser = document(() => 'guide')
    expect(browser.markdown()).toBe(markdown)
    expect(browser.isLoading()).toBe(false)
    await settle()
    expect(backend.requests).toEqual([])

    browser.reload()
    TestBed.tick()
    expect(browser.isLoading()).toBe(true)
    expect(browser.markdown()).toBe(markdown)
    await settle()
    expect(browser.markdown()).toBe(markdown)
    expect(backend.requests).toEqual(['/docs/guide.md', '/translations/fr.json'])
  })

  it('should keep the previous document on screen while the next one loads', async () => {
    const locale = signal('en')
    const path = signal('index')
    setup({ diglot: options({ locale }), served: await files() })
    const doc = document(path)
    await settle()
    const english = doc.markdown()
    locale.set('fr')
    TestBed.tick()
    expect(doc.isLoading()).toBe(true)
    expect(doc.markdown()).toBe(english)
    expect(doc.locale()).toBe('en')
    expect(doc.report()).toBeNull()
    await settle()
    expect(doc.markdown()).toContain('Bienvenue')
    expect(doc.locale()).toBe('fr')
    expect(doc.report()).toMatchObject({ applied: 2 })
  })

  it('should load documents again once the app is stable instead of the server copy', async () => {
    setup({ served: await files() })
    TestBed.inject(TransferState).set(makeStateKey<{ markdown: string, report: null }>('diglot:en:guide'), { markdown: '# Older\n', report: null })
    const path = signal('guide')
    const doc = document(path)
    expect(doc.markdown()).toBe('# Older\n')
    await settle()
    path.set('index')
    await settle()
    path.set('guide')
    await settle()
    expect(doc.markdown()).toBe(sources.guide)
  })

  it('should drop the document when the next one fails', async () => {
    const path = signal('index')
    setup({ served: await files() })
    const doc = document(path)
    await settle()
    expect(doc.markdown()).toContain('Welcome')
    path.set('missing')
    await settle()
    expect(doc.error()).toBeInstanceOf(Error)
    expect(doc.markdown()).toBeUndefined()
    expect(doc.report()).toBeUndefined()
  })
})

describe('withDiglotRouteLocale', () => {
  const Empty = Component({ template: '' })(class Empty {})
  const Index = Component({ template: '' })(class Index {
    readonly doc = diglotDocument(() => 'index')
  })

  it('should follow the locale of the route', async () => {
    const backend = setup({ diglot: options(), features: [withDiglotRouteLocale()], served: await files() })
    const router = TestBed.inject(Router)
    const doc = document(() => 'index')
    await router.navigateByUrl('/fr/index')
    await settle()
    expect(doc.locale()).toBe('fr')
    expect(doc.markdown()).toContain('Bienvenue')
    await router.navigateByUrl('/elsewhere')
    await settle()
    expect(doc.locale()).toBe('en')
    expect(backend.requests).not.toContain('/translations/en.json')
  })

  it('should load the components of a navigation in its locale only', async () => {
    const backend = setup({ features: [withDiglotRouteLocale()], routes: [{ path: ':locale/page', component: Index }], served: await files() })
    const harness = await RouterTestingHarness.create('/elsewhere')
    await harness.navigateByUrl('/fr/page', Index)
    await settle()
    expect(backend.requests).toEqual(['/docs/index.md', '/translations/fr.json'])
  })

  it('should keep the locale of the page on screen while a lazy route loads', async () => {
    let load!: () => void
    const lazy = new Promise<typeof Empty>(resolve => load = () => resolve(Empty))
    setup({ features: [withDiglotRouteLocale()], routes: [{ path: ':locale/lazy', loadComponent: () => lazy }], served: await files() })
    const router = TestBed.inject(Router)
    const locale = TestBed.inject(DIGLOT_LOCALE)
    await router.navigateByUrl('/en/index')
    const navigation = router.navigateByUrl('/fr/lazy')
    await new Promise(resolve => setTimeout(resolve))
    expect(locale()).toBe('en')
    load()
    await navigation
    expect(locale()).toBe('fr')
  })

  it('should keep the locale when a navigation is cancelled', async () => {
    setup({ features: [withDiglotRouteLocale()], routes: [{ path: ':locale/blocked', canActivate: [() => false], component: Empty }], served: await files() })
    const router = TestBed.inject(Router)
    const locale = TestBed.inject(DIGLOT_LOCALE)
    await router.navigateByUrl('/en/index')
    expect(await router.navigateByUrl('/fr/blocked')).toBe(false)
    expect(locale()).toBe('en')
  })
})
