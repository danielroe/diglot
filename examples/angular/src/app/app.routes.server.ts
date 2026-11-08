import type { ServerRoute } from '@angular/ssr'
import { RenderMode } from '@angular/ssr'
import { locales, pages } from './locales'

const slugs = pages.filter(slug => slug !== 'index')

export const serverRoutes: ServerRoute[] = [
  { path: 'picker', renderMode: RenderMode.Prerender },
  {
    path: 'picker/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => slugs.map(slug => ({ slug })),
  },
  {
    path: ':locale',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => locales.map(({ code }) => ({ locale: code })),
  },
  {
    path: ':locale/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => locales.flatMap(({ code }) => slugs.map(slug => ({ locale: code, slug }))),
  },
  { path: '**', renderMode: RenderMode.Prerender },
]
