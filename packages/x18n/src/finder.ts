import type { LocaleFinder } from '@x18n/core'
import type { DiglotState } from './state.ts'
import { recordPath } from '@diglot/store'
import { join } from 'pathe'
import { RECORD_FORMAT } from './format.ts'

export function recordFinder(state: DiglotState): LocaleFinder {
  return {
    id: 'diglot',
    find: async () => [],
    resolveKey({ key, locale }) {
      if (!state.segments.has(key) || !state.config?.locales.includes(locale))
        return
      return { path: join(state.prefix, recordPath(locale, key)), format: RECORD_FORMAT }
    },
  }
}
