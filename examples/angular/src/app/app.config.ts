import type { ApplicationConfig } from '@angular/core'
import type { PolicySnapshot } from '@diglot/core'
import { provideHttpClient, withFetch } from '@angular/common/http'
import { provideClientHydration } from '@angular/platform-browser'
import { provideRouter, withComponentInputBinding } from '@angular/router'
import { provideDiglot } from '@diglot/angular'
import { withDiglotRouteLocale } from '@diglot/angular/router'
import policy from '../../translations/.diglot/policy.json'
import { routes } from './app.routes'
import { defaultLocale } from './locales'

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideClientHydration(),
    provideDiglot({
      defaultLocale,
      bundleUrl: locale => `/translations/${locale}.json`,
      sourceUrl: path => `/docs/${path}.md`,
      policy: policy as PolicySnapshot,
      parser: 'mdast',
    }, withDiglotRouteLocale('locale')),
  ],
}
