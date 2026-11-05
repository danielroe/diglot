/** What the integration shares with the loaders of the content config. */
export interface DiglotState {
  /** Absolute directory of the translations repository, keyed by the absolute project root. */
  translations: Map<string, string>
  /** Translated MDX documents, keyed by the absolute path of their virtual file. */
  modules: Map<string, string>
  /** Called with the path of every virtual file whose content changed. */
  listeners: Set<(path: string) => void>
}

/**
 * The content config runs in Vite's module runner, apart from the integration, so the two only
 * share the global object.
 */
export function getState(): DiglotState {
  return globalThis.__diglotAstro ??= { translations: new Map(), modules: new Map(), listeners: new Set() }
}

/** Stores a translated MDX document and tells the Vite plugin when it changed. */
export function setModule(path: string, code: string): void {
  const { listeners, modules } = getState()
  if (modules.get(path) === code)
    return
  modules.set(path, code)
  for (const listener of listeners)
    listener(path)
}

/** Removes a translated MDX document and tells the Vite plugin. */
export function deleteModule(path: string): void {
  const { listeners, modules } = getState()
  if (!modules.delete(path))
    return
  for (const listener of listeners)
    listener(path)
}

declare global {
  // eslint-disable-next-line vars-on-top
  var __diglotAstro: DiglotState | undefined
}
