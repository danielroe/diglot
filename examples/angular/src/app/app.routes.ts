import type { Routes } from '@angular/router'
import { defaultLocale, isLocale } from './locales'
import { Page } from './page'

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: defaultLocale },
  {
    path: ':locale',
    canMatch: [(_route, segments) => isLocale(segments[0]?.path)],
    children: [
      { path: '', component: Page, data: { slug: 'index' } },
      { path: ':slug', component: Page },
    ],
  },
  { path: '**', redirectTo: defaultLocale },
]
