import type { Plugin } from 'vite'
import { isTranslatedModule } from './ids.ts'
import { getState } from './state.ts'

/**
 * Serves the translated MDX documents of the loader from virtual files next to their sources.
 * Astro imports a deferred entry by its file path with a query, such as `?astroPropagatedAssets`,
 * and `@astrojs/mdx` compiles the code this plugin loads like any other `.mdx` file.
 */
export function vitePluginDiglot(): Plugin {
  return {
    name: '@diglot/astro:translated-mdx',
    enforce: 'pre',
    resolveId(id) {
      if (isTranslatedModule(pathOf(id)))
        return id
    },
    load(id) {
      const path = pathOf(id)
      if (isTranslatedModule(path))
        return getState().modules.get(path) ?? ''
    },
    configureServer(server) {
      const { listeners } = getState()
      const invalidate = (path: string) => {
        for (const environment of Object.values(server.environments)) {
          for (const module of environment.moduleGraph.getModulesByFile(path) ?? [])
            environment.moduleGraph.invalidateModule(module)
        }
      }
      listeners.add(invalidate)
      server.httpServer?.once('close', () => listeners.delete(invalidate))
    },
  }
}

function pathOf(id: string): string {
  return id.split('?')[0]!
}
