import type { Catalog } from '../src/diglot.ts'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { createElement } from 'react'
import { renderToString as renderReact } from 'react-dom/server'
import { createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString as renderVue } from 'vue/server-renderer'
import { createDiglot } from '../src/diglot.ts'
import diglot from '../src/vite.ts'
import { createDiglot as createVueDiglot } from '../src/vue.ts'
import { canonical, components, fixtures, pseudoTranslations, quiet, runtime, unpseudo } from './utils.ts'

type Server = Awaited<ReturnType<typeof createServer>>
type Render = (server: Server, file: string, locale: string) => Promise<string>

/**
 * Renders every component of a fixture directory on the server as written, and through the plugin
 * in the source locale and in a pseudo locale. The plugin must not change the page, and the pseudo
 * locale must change its text and nothing else.
 */
function oracle(framework: 'react' | 'svelte' | 'vue', plugin: () => any, render: (catalog: () => Catalog) => Render, changed: number) {
  const root = join(fixtures, framework)
  const files = components(root).filter(file => file !== 'Root.svelte')
  let translations: string
  let raw: Server
  let translated: Server
  let catalog: Catalog
  const pages = new Map<string, string>()

  beforeAll(async () => {
    translations = await pseudoTranslations(root)
    raw = await createServer({ ...quiet(root, framework), plugins: [plugin()] })
    translated = await createServer({ ...quiet(root, framework), plugins: [diglot({ translations }), plugin()] })
    await translated.pluginContainer.buildStart({})
    catalog = (await translated.ssrLoadModule('virtual:diglot/fr')).default
  }, 60_000)

  afterAll(async () => {
    await raw.close()
    await translated.close()
    rmSync(translations, { recursive: true, force: true })
  })

  const draw = render(() => catalog)

  it.each(files)('should render %s as written in the source locale', async (file) => {
    const before = await draw(raw, file, 'en')
    pages.set(file, before)
    expect(canonical(await draw(translated, file, 'en'))).toBe(canonical(before))
  })

  it.each(files)('should change only the text of %s in a pseudo locale', async (file) => {
    const before = pages.get(file) ?? await draw(raw, file, 'en')
    const after = await draw(translated, file, 'fr')
    expect(canonical(after, unpseudo)).toBe(canonical(before, unpseudo))
    pages.set(`fr:${file}`, after)
  })

  it('should translate text in every component that has some', () => {
    expect(files.filter(file => pages.get(`fr:${file}`) !== pages.get(file))).toHaveLength(changed)
  })
}

describe('vue', () => {
  oracle('vue', vue, catalog => async (server, file, locale) => {
    const { default: component } = await server.ssrLoadModule(`/${file}`)
    const app = createSSRApp({ render: () => h(component) })
    app.config.warnHandler = (message) => {
      throw new Error(`${file}: ${message}`)
    }
    app.use(createVueDiglot({ locale, messages: { fr: catalog() } }))
    return renderVue(app)
  }, 13)
})

describe('react', () => {
  oracle('react', react, catalog => async (server, file, locale) => {
    const { default: component } = await server.ssrLoadModule(`/${file}`)
    // Through the server, so that the provider and the rewritten components share one context.
    const { DiglotProvider } = await server.ssrLoadModule(runtime('react'))
    return renderReact(createElement(DiglotProvider, { diglot: createDiglot({ locale, messages: { fr: catalog() } }) }, createElement(component)))
  }, 13)
})

describe('svelte', () => {
  oracle('svelte', () => svelte({ configFile: false }), catalog => async (server, file, locale) => {
    const { default: component } = await server.ssrLoadModule(`/${file}`)
    const { default: Root } = await server.ssrLoadModule('/Root.svelte')
    // Through the server, so that the renderer shares its copy of Svelte, and its context, with the components.
    const { render } = await server.ssrLoadModule('svelte/server')
    return render(Root, { props: { component, diglot: createDiglot({ locale, messages: { fr: catalog() } }) } }).body
  }, 16)
})
