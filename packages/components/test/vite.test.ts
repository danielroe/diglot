import type { HotPayload } from 'vite'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecord } from '@diglot/core'
import { writeRecord } from '@diglot/store'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extract } from '../src/index.ts'
import { createDiglot } from '../src/runtime/diglot.ts'
import diglot from '../src/vite.ts'
import { fixtures } from './utils.ts'

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

  it('should serve only the source locale without a translations repository', async () => {
    const server = await createServer({ logLevel: 'silent', configFile: false, root, appType: 'custom', server: { middlewareMode: true, ws: false }, plugins: [diglot(), vue()] })
    expect((await server.ssrLoadModule('virtual:diglot')).default).toEqual({ sourceLocale: 'en', locales: {} })
    await server.close()
  })
})

describe('hot updates', () => {
  it('should send a changed record to the page without a full reload', { timeout: 30_000 }, async () => {
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
    await server.close()

    const update = sent.find(p => p.type === 'custom' && p.event === 'diglot:locale') as { data: { locale: string, catalog: Record<string, string> } }
    expect(update.data).toEqual({ locale: 'fr', catalog: { [footer.hash]: 'Pied de page' } })
    expect(sent.some(p => p.type === 'full-reload')).toBe(false)
    expect(code).toContain(`import.meta.hot.on('diglot:locale'`)

    // What the code of `virtual:diglot` does with the event in the browser.
    vi.stubGlobal('window', globalThis)
    const page = createDiglot({ locale: 'fr', messages: { fr: {} } })
    const listener = vi.fn()
    page.subscribe(listener)
    for (const ref of (globalThis as any)[Symbol.for('@diglot/components')])
      ref.deref()?.update(update.data.locale, update.data.catalog)
    expect(page.t(footer.hash, 'Default footer')).toBe('Pied de page')
    expect(listener).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
