import type { Policy } from '@diglot/core'
import type { DiglotOptions } from './provide.ts'
import { InjectionToken } from '@angular/core'

/** The options of `provideDiglot()`, with the policy restored. */
export interface DiglotConfig extends Omit<DiglotOptions, 'locale' | 'policy' | 'policyFunctions'> {
  policy: Policy
}

export const DIGLOT_CONFIG: InjectionToken<DiglotConfig> = new InjectionToken<DiglotConfig>('DIGLOT_CONFIG')

/** Returns the locale documents are shown in. */
export const DIGLOT_LOCALE: InjectionToken<() => string> = new InjectionToken<() => string>('DIGLOT_LOCALE')
