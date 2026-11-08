import type { Provider } from '@angular/core'
import type { ActivatedRouteSnapshot } from '@angular/router'
import { inject, InjectionToken, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router } from '@angular/router'
import { filter, map } from 'rxjs'
import { defaultLocale } from './locales'

export const DIGLOT_LOCALE = new InjectionToken<() => string>('DIGLOT_LOCALE')

export const lang = signal<string>(defaultLocale)

export function provideRouteLocale(param = 'locale'): Provider {
  return {
    provide: DIGLOT_LOCALE,
    useFactory: () => {
      const router = inject(Router)
      const read = () => routeParam(router.routerState.snapshot.root, param) ?? defaultLocale
      return toSignal(router.events.pipe(filter(event => event instanceof NavigationEnd), map(read)), { initialValue: read() })
    },
  }
}

function routeParam(root: ActivatedRouteSnapshot, param: string): string | undefined {
  let value: string | undefined
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild)
    value = route.params[param] ?? value
  return value
}
