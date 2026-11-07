import type { ActivatedRouteSnapshot } from '@angular/router'
import type { DiglotFeature } from './provide.ts'
import { DestroyRef, inject, signal } from '@angular/core'
import { NavigationCancel, NavigationError, ResolveEnd, Router } from '@angular/router'
import { DIGLOT_CONFIG, DIGLOT_LOCALE } from './tokens.ts'

/**
 * Reads the locale from a route parameter, such as `:locale` in `/:locale/docs/**`. Routes
 * without it show the default locale. The locale changes before the components of a
 * navigation are created, so they never load the previous locale first.
 */
export function withDiglotRouteLocale(param = 'locale'): DiglotFeature {
  return {
    kind: 'locale',
    providers: [{
      provide: DIGLOT_LOCALE,
      useFactory: () => {
        const router = inject(Router)
        const { defaultLocale } = inject(DIGLOT_CONFIG)
        const read = (root: ActivatedRouteSnapshot) => routeParam(root, param) ?? defaultLocale
        const locale = signal(read(router.routerState.snapshot.root))
        const subscription = router.events.subscribe((event) => {
          if (event instanceof ResolveEnd)
            locale.set(read(event.state.root))
          else if (event instanceof NavigationCancel || event instanceof NavigationError)
            locale.set(read(router.routerState.snapshot.root))
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
