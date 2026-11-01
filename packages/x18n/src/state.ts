import type { Glossary, LocaleStyle } from '@diglot/core'
import type { ResolvedConfig } from '@diglot/store'
import { loadConfig, loadGlossary, loadStyle, manifestPath, readManifests } from '@diglot/store'
import { relative } from 'pathe'

export interface DiglotState {
  config?: ResolvedConfig
  skeletons: Map<string, string>
  glossaries: Map<string, Glossary>
  styles: Map<string, LocaleStyle>
  manifests: string[]
  prefix: string
}

export function createState(): DiglotState {
  return { skeletons: new Map(), glossaries: new Map(), styles: new Map(), manifests: [], prefix: '' }
}

export async function loadState(state: DiglotState, root: string): Promise<ResolvedConfig> {
  const config = await loadConfig(root)
  state.config = config
  const manifests = await readManifests(config.stateDir)
  state.manifests = manifests.map(m => relative(root, manifestPath(config.stateDir, m.source)))
  state.skeletons = new Map(manifests.flatMap(m => Object.values(m.files).flat().map(e => [e.hash, e.skeleton] as const)))
  for (const locale of config.locales) {
    const glossary = await loadGlossary(root, locale, config.glossary ? { shared: config.glossary } : {})
    if (glossary)
      state.glossaries.set(locale, glossary)
    const style = await loadStyle(root, locale)
    if (style)
      state.styles.set(locale, style)
  }
  return config
}
