import type { Routes } from '@angular/router'
import { DIGLOT_LOCALE, lang, provideRouteLocale } from './language'
import { defaultLocale, isLocale } from './locales'
import { Page } from './page'

const pageRoutes: Routes = [
  { path: '', component: Page, data: { slug: 'index' } },
  { path: ':slug', component: Page },
]

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: defaultLocale },
  {
    path: 'picker',
    providers: [{ provide: DIGLOT_LOCALE, useValue: lang }],
    data: { picker: true },
    children: pageRoutes,
  },
  {
    path: ':locale',
    canMatch: [(_route, segments) => isLocale(segments[0]?.path)],
    providers: [provideRouteLocale('locale')],
    data: { picker: false },
    children: pageRoutes,
  },
  { path: '**', redirectTo: defaultLocale },
]
