import type { ActivatedRouteSnapshot } from '@angular/router'
import type { DiglotFeature } from './provide.ts'
import { DestroyRef, inject, signal } from '@angular/core'
import { NavigationEnd, Router } from '@angular/router'
import { DIGLOT_CONFIG, DIGLOT_LOCALE } from './tokens.ts'

/**
 * Reads the locale from a route parameter, such as `:locale` in `/:locale/docs/**`. Routes
 * without it show the default locale. The locale changes when a navigation activates its routes:
 * the components it creates load the new locale first, and the page on screen keeps its locale
 * until then.
 */
export function withDiglotRouteLocale(param = 'locale'): DiglotFeature {
  return {
    kind: 'locale',
    providers: [{
      provide: DIGLOT_LOCALE,
      useFactory: () => {
        const router = inject(Router)
        const { defaultLocale } = inject(DIGLOT_CONFIG)
        const read = () => routeParam(router.routerState.snapshot.root, param) ?? defaultLocale
        const locale = signal(read())
        const subscription = router.events.subscribe((event) => {
          if (event instanceof NavigationEnd)
            locale.set(read())
        })
        inject(DestroyRef).onDestroy(() => subscription.unsubscribe())
        return locale.asReadonly()
      },
    }],
  }
}

/** The value of `param` on the deepest route that has it. */
function routeParam(root: ActivatedRouteSnapshot, param: string): string | undefined {
  let value: string | undefined
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (param in route.params)
      value = route.params[param]
  }
  return value
}
