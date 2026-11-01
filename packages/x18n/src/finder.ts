import type { KeyString, LocaleCode, LocaleFinder } from '@x18n/core'
import type { DiglotState } from './state.ts'
import { recordPath } from '@diglot/store'
import { join } from 'pathe'
import { RECORD_FORMAT } from './format.ts'

/** `resolveKey` is a proposed x18n API that places a new key in its own file; x18n 0.1.5 ignores it. */
interface KeyFinder extends LocaleFinder {
  resolveKey: (target: { key: KeyString, locale: LocaleCode }) => { path: string, format: string } | undefined
}

export function recordFinder(state: DiglotState): KeyFinder {
  return {
    id: 'diglot',
    find: async () => [],
    resolveKey({ key, locale }) {
      if (!state.skeletons.has(key) || !state.config?.locales.includes(locale))
        return
      return { path: join(state.prefix, recordPath(locale, key)), format: RECORD_FORMAT }
    },
  }
}
