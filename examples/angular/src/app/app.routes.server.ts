import type { ServerRoute } from '@angular/ssr'
import { RenderMode } from '@angular/ssr'
import { locales, pages } from './locales'

export const serverRoutes: ServerRoute[] = [
  {
    path: ':locale',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => locales.map(({ code }) => ({ locale: code })),
  },
  {
    path: ':locale/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => locales.flatMap(({ code }) => pages.filter(slug => slug !== 'index').map(slug => ({ locale: code, slug }))),
  },
  { path: '**', renderMode: RenderMode.Prerender },
]
