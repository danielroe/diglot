import type { HotPayload } from 'vite'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecord } from '@diglot/core'
import { recordPath, writeRecord } from '@diglot/store'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { createElement } from 'react'
import { renderToString as renderReact } from 'react-dom/server'
import { createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createDiglot } from '../src/diglot.ts'
import { extract } from '../src/index.ts'
import diglot from '../src/vite.ts'
import { createDiglot as createVueDiglot } from '../src/vue.ts'
import { fixtures, runtime } from './utils.ts'

const root = join(fixtures, 'vue')
const repositories: string[] = []

async function segment(file: string, index = 0) {
  return (await extract(readFileSync(join(root, file), 'utf8'), { file }))[index]!
}

function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diglot-components-'))
  writeFileSync(join(dir, 'diglot.config.ts'), `export default { locales: ['fr', 'de'] }\n`)
  repositories.push(dir)
  return dir
}

/** A project with one component, next to the fixtures so that it resolves their dependencies, and its translations repository. */
function project(file: string, code: string): { dir: string, translations: string } {
  const dir = mkdtempSync(join(fixtures, '.tmp-'))
  repositories.push(dir)
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), code)
  return { dir, translations: repository() }
}

afterEach(() => {
  for (const dir of repositories.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('virtual:diglot', () => {
  it('should load a catalog for each locale of the translations repository', async () => {
    const translations = repository()
    const footer = await segment('Card.vue')
    await writeRecord(translations, 'fr', createRecord({ segment: footer, text: 'Pied de page', origin: 'human' }))
    const server = await createServer({ logLevel: 'silent', configFile: false, root, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot({ translations }), vue()] })
    await server.pluginContainer.buildStart({})
    const { default: translated } = await server.ssrLoadModule('virtual:diglot')
    expect(translated.sourceLocale).toBe('en')
    expect(Object.keys(translated.locales)).toEqual(['fr', 'de'])
    expect(await translated.locales.fr()).toEqual({ [footer.hash]: 'Pied de page' })
    expect(await translated.locales.de()).toEqual({})
    await server.close()
  })

  it('should leave out translations that fail validation and rejected ones', async () => {
    const translations = repository()
    const [read, hello] = [await segment('Mixed.vue'), await segment('Plain.vue')]
    await writeRecord(translations, 'fr', createRecord({ segment: read, text: 'Lisez la documentation avant de {1}déployer{/1}.', origin: 'mt' }))
    await writeRecord(translations, 'fr', createRecord({ segment: hello, text: 'Bonjour', origin: 'mt', review: 'rejected', rejectedBy: { by: 'danielroe', at: '2026-11-01T00:00:00.000Z' } }))
    const server = await createServer({ logLevel: 'silent', configFile: false, root, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot({ translations }), vue()] })
    await server.pluginContainer.buildStart({})
    expect((await server.ssrLoadModule('virtual:diglot/fr')).default).toEqual({})
    await server.close()
  })

  it('should map rewritten components to their files', async () => {
    const { dir } = project('src/components/Card.vue', '<template><p>Hello</p></template>\n')
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot(), vue()] })
    const result = await server.environments.client.transformRequest('/src/components/Card.vue')
    expect(result!.map).toMatchObject({ sources: ['Card.vue'] })
    await server.close()
  })

  it('should translate the text of the component that provides the instance', async () => {
    const app = '<script>\n  import { setDiglot } from "@diglot/components/svelte";\n  let { diglot } = $props();\n  setDiglot(diglot);\n</script>\n\n<p>Hello</p>\n'
    const { dir, translations } = project('src/App.svelte', app)
    const [hello] = await extract(app, { file: 'src/App.svelte' })
    await writeRecord(translations, 'fr', createRecord({ segment: hello!, text: 'Bonjour', origin: 'human' }))
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, resolve: { alias: { '@diglot/components/svelte': runtime('svelte') } }, plugins: [diglot({ translations }), svelte({ configFile: false })] })
    await server.pluginContainer.buildStart({})
    const { default: App } = await server.ssrLoadModule('/src/App.svelte')
    const { render } = await server.ssrLoadModule('svelte/server')
    const { default: fr } = await server.ssrLoadModule('virtual:diglot/fr')
    expect(render(App, { props: { diglot: createDiglot({ locale: 'fr', messages: { fr } }) } }).body).toContain('<p>Bonjour</p>')
    await server.close()
  })

  it('should warn about a component it can\'t parse, and read the others', async () => {
    const { dir, translations } = project('src/Broken.svelte', '<p>Hello {</p>\n')
    writeFileSync(join(dir, 'src/Card.vue'), '<template><p>Hello</p></template>\n')
    const [hello] = await extract('<template><p>Hello</p></template>\n', { file: 'src/Card.vue' })
    await writeRecord(translations, 'fr', createRecord({ segment: hello!, text: 'Bonjour', origin: 'human' }))
    const warn = vi.fn()
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, customLogger: { warn, info() {}, warnOnce() {}, error() {}, clearScreen() {}, hasErrorLogged: () => false, hasWarned: false }, plugins: [diglot({ translations }), vue()] })
    await server.pluginContainer.buildStart({})
    expect(warn.mock.calls.join()).toContain('src/Broken.svelte is not translated')
    expect((await server.ssrLoadModule('virtual:diglot/fr')).default).toEqual({ [hello!.hash]: 'Bonjour' })
    await server.close()
  })

  it('should render entities in Vue templates as written', async () => {
    const { dir } = project('src/Entities.vue', '<template><p title="&amp;copy; 2024">Tom &amp;amp; Jerry</p></template>\n')
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot(), vue()] })
    const { default: component } = await server.ssrLoadModule('/src/Entities.vue')
    const app = createSSRApp({ render: () => h(component) }).use(createVueDiglot())
    expect(await renderToString(app)).toBe('<p title="&amp;copy; 2024">Tom &amp;amp; Jerry</p>')
    await server.close()
  })

  it('should keep the selected React option, whose text is a string', async () => {
    const { dir } = project('src/Select.tsx', 'export default function Select({ name }) { return <select defaultValue="Hello Ada" onChange={() => {}}><option>Bye</option><option>Hello {name}</option></select> }\n')
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, resolve: { alias: { '@diglot/components/react': runtime('react') } }, plugins: [diglot(), react()] })
    const { default: Select } = await server.ssrLoadModule('/src/Select.tsx')
    expect(renderReact(createElement(Select, { name: 'Ada' }))).toBe('<select><option>Bye</option><option selected="">Hello Ada</option></select>')
    await server.close()
  })

  it('should leave other views of a component alone, such as `?raw`', async () => {
    const { dir, translations } = project('src/Card.vue', '<template><p>Hello</p></template>\n')
    const [hello] = await extract('<template><p>Hello</p></template>\n', { file: 'src/Card.vue' })
    await writeRecord(translations, 'fr', createRecord({ segment: hello!, text: 'Bonjour', origin: 'human' }))
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot({ translations }), vue()] })
    await server.pluginContainer.buildStart({})
    expect((await server.ssrLoadModule('/src/Card.vue?raw')).default).toBe('<template><p>Hello</p></template>\n')
    expect((await server.ssrLoadModule('virtual:diglot/fr')).default).toEqual({ [hello!.hash]: 'Bonjour' })
    await server.close()
  })

  it('should leave JSX alone without the React plugin', async () => {
    const code = 'export const Note = () => <p>Hello</p>\n'
    const { dir } = project('src/Note.tsx', code)
    const server = await createServer({ logLevel: 'silent', configFile: false, root: dir, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot(), vue()] })
    expect((await server.environments.client.transformRequest('/src/Note.tsx'))!.code).not.toContain('@diglot/components/react')
    await server.close()
  })

  it('should serve only the source locale without a translations repository', async () => {
    const server = await createServer({ logLevel: 'silent', configFile: false, root, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot(), vue()] })
    expect((await server.ssrLoadModule('virtual:diglot')).default).toEqual({ sourceLocale: 'en', locales: {} })
    await server.close()
  })
})

describe('hot updates', () => {
  it('should send changed and deleted records to the page without a full reload', { timeout: 30_000 }, async () => {
    const translations = repository()
    const footer = await segment('Card.vue')
    const server = await createServer({ logLevel: 'silent', configFile: false, root, server: { port: 0 }, plugins: [diglot({ translations }), vue()] })
    await server.listen()
    await server.pluginContainer.buildStart({})
    const sent: HotPayload[] = []
    const hot = server.environments.client.hot
    const send = hot.send.bind(hot)
    hot.send = ((payload: HotPayload) => {
      sent.push(payload)
      send(payload)
    }) as typeof hot.send
    const code = (await server.environments.client.transformRequest('virtual:diglot'))!.code
    await server.environments.client.transformRequest('virtual:diglot/fr')

    await writeRecord(translations, 'fr', createRecord({ segment: footer, text: 'Pied de page', origin: 'human' }))
    await vi.waitFor(() => expect(sent.some(p => p.type === 'custom' && p.event === 'diglot:locale')).toBe(true), { timeout: 10_000 })

    rmSync(join(translations, recordPath('fr', footer.hash)))
    await vi.waitFor(() => expect(sent.filter(p => p.type === 'custom' && p.event === 'diglot:locale')).toHaveLength(2), { timeout: 10_000 })
    await server.close()

    const [update, removal] = sent.filter(p => p.type === 'custom' && p.event === 'diglot:locale') as Array<{ data: { locale: string, catalog: Record<string, string> } }>
    expect(update!.data).toEqual({ locale: 'fr', catalog: { [footer.hash]: 'Pied de page' } })
    expect(removal!.data).toEqual({ locale: 'fr', catalog: {} })
    expect(sent.some(p => p.type === 'full-reload')).toBe(false)
    expect(code).toContain(`import.meta.hot.on('diglot:locale'`)

    // What the code of `virtual:diglot` does with the event in the browser.
    vi.stubGlobal('window', globalThis)
    const page = createDiglot({ locale: 'fr', messages: { fr: {} } })
    const listener = vi.fn()
    page.subscribe(listener)
    for (const ref of (globalThis as any)[Symbol.for('@diglot/components')])
      ref.deref()?.update(update!.data.locale, update!.data.catalog)
    expect(page.t(footer.hash, 'Default footer')).toBe('Pied de page')
    expect(listener).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
