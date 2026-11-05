/** What the plugin shares with `diglotDocsLoader()`, keyed by the absolute project root. */
export interface StarlightSettings {
  /** `editLink.baseUrl` of the Starlight config. */
  editLinkBaseUrl?: string
  /** `lastUpdated` of the Starlight config. */
  lastUpdated: boolean
}

/** The content config runs in Vite's module runner, apart from the plugin, so the two only share the global object. */
export function getSettings(): Map<string, StarlightSettings> {
  return globalThis.__diglotStarlight ??= new Map()
}

declare global {
  // eslint-disable-next-line vars-on-top
  var __diglotStarlight: Map<string, StarlightSettings> | undefined
}
