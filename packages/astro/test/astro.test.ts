import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRecord } from '@diglot/core'
import { extract } from '@diglot/mdast'
import { writeRecord } from '@diglot/store'
import { build } from 'astro'
import { afterAll, describe, expect, it } from 'vitest'
import { splitFrontmatter } from '../src/frontmatter.ts'
import { isTargetId, isTranslatedModule, translatedId, translatedModulePath } from '../src/ids.ts'
import { resolveLocales } from '../src/locales.ts'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const astroBin = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url))
const copies: string[] = []

/** Copies the fixture site next to the original, so that its relative imports still resolve. */
function copyFixture(): string {
  const root = mkdtempSync(join(fixtures, '.tmp-'))
  cpSync(join(fixtures, 'site'), root, { recursive: true, filter: path => !/[/\\](?:dist|\.astro|node_modules)$/.test(path) })
  copies.push(root)
  return root
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    }).on('error', reject)
  })
}

afterAll(() => {
  for (const root of copies)
    rmSync(root, { recursive: true, force: true })
})

describe('resolveLocales', () => {
  it('should match Astro locales to diglot locales by path or code, ignoring case', () => {
    const i18n = { defaultLocale: 'en', locales: ['en', 'fr', { path: 'pt-br', codes: ['pt-BR'] as [string] }, { path: 'spanish', codes: ['es'] as [string] }, 'de'], routing: 'manual' as const }
    expect(resolveLocales(i18n, ['fr', 'pt-BR', 'es', 'ja'])).toEqual({
      defaultPath: 'en',
      targets: [{ path: 'fr', locale: 'fr' }, { path: 'pt-br', locale: 'pt-BR' }, { path: 'spanish', locale: 'es' }],
      unmatched: ['de'],
    })
  })
})

describe('translatedId', () => {
  it('should move ids from the default locale directory or the root into the target locale', () => {
    expect(['en/guide/intro', 'en', 'guide/intro', 'index'].map(id => translatedId(id, 'en', 'fr'))).toEqual(['fr/guide/intro', 'fr', 'fr/guide/intro', 'fr'])
  })

  it('should tell target locale ids apart from source ids', () => {
    expect(['fr', 'fr/guide', 'french/guide', 'guide'].map(id => isTargetId(id, ['fr', 'de']))).toEqual([true, true, false, false])
  })

  it('should place translated MDX modules next to their source', () => {
    expect(translatedModulePath('/site/src/content/docs/en/cards.mdx', 'pt-br')).toBe('/site/src/content/docs/en/cards.diglot-pt-br.mdx')
    expect(['/a/cards.diglot-fr.mdx', '/a/cards.mdx', '/a/cards.diglot-fr.md'].map(isTranslatedModule)).toEqual([true, false, false])
  })
})

describe('splitFrontmatter', () => {
  it('should split YAML frontmatter from the body', () => {
    expect(splitFrontmatter('---\ntitle: Hello\ndescription: >-\n  Two\n  lines\n---\n\n# Body\n')).toEqual({ data: { title: 'Hello', description: 'Two lines' }, body: '# Body' })
    expect(splitFrontmatter('---\n---\nBody')).toEqual({ data: {}, body: 'Body' })
    expect(splitFrontmatter('# No frontmatter\n')).toEqual({ data: {}, body: '# No frontmatter' })
  })

  it('should skip TOML frontmatter', () => {
    expect(splitFrontmatter('+++\ntitle = "Hello"\n+++\n')).toBeUndefined()
  })
})

describe('diglotLoader', () => {
  it('should build translated pages from the records of each locale', { timeout: 60_000 }, async () => {
    const root = copyFixture()
    await build({ root, logLevel: 'error' })
    const page = (path: string) => readFileSync(join(root, 'dist', path, 'index.html'), 'utf8')

    expect(page('fr/guide')).toContain('<title>Guide</title><meta name="description" content="Découvrez comment le site est construit.">')
    expect(page('fr/guide')).toContain('<h1 id="premiers-pas">Premiers pas</h1>')
    expect(page('fr/guide')).toMatch(/<img alt="Le logo"[^>]* src="\/_astro\/logo\.[\w-]+\.svg"/)
    expect(page('fr')).toContain('<p>Lisez le <a href="/en/guide/">guide</a> pour commencer.</p>')
    expect(page('pt-br/guide')).toContain('<h1 id="primeiros-passos">Primeiros passos</h1>\n<p>Install the package with <code>pnpm add example</code>.</p>')
    expect(page('fr/hand')).toContain('Cette page a une traduction écrite à la main.')
    expect(page('fr/cards')).toMatch(/<p>Lisez les 2 cartes ci-dessous\.<\/p>\s*<section class="card"><h2>Premiers pas<\/h2><p>Installez d’abord le <strong>paquet<\/strong>\.<\/p><\/section>/)
    expect(page('fr/cards')).toMatch(/<img src="\/_astro\/logo\.[\w-]+\.svg"[^>]* alt="Le logo"/)
    expect(() => page('fr/untranslated')).toThrow()
    expect(() => page('de/guide')).toThrow()
  })

  it('should reload translated entries when records or sources change in dev', { timeout: 60_000 }, async () => {
    const root = copyFixture()
    const port = await freePort()
    // Astro's dev server does not serve pages when it detects Vitest, so it runs from the CLI without Vitest's environment.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST')))
    execFileSync(process.execPath, [astroBin, 'dev', '--background', '--root', root, '--port', String(port)], { env, stdio: 'ignore' })
    const waitFor = async (text: string, path = '/fr/guide/') => {
      const url = `http://localhost:${port}${path}`
      let last = ''
      for (let attempt = 0; attempt < 200; attempt++) {
        last = await fetch(url).then(async response => `${response.status} ${await response.text()}`, (error: Error) => error.message)
        if (last.includes(text))
          return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`${url} never contained "${text}": ${last.slice(0, 500)}`)
    }
    try {
      await waitFor('Premiers pas')

      const source = join(root, 'src/content/docs/en/guide.md')
      const heading = (await extract(readFileSync(source, 'utf8'), { parser: 'satteri' })).find(s => s.kind === 'heading')!
      await writeRecord(join(root, 'translations'), 'fr', createRecord({ segment: heading, text: 'Bien démarrer', origin: 'human', updatedAt: '2026-11-02T00:00:00.000Z' }))
      await waitFor('Bien démarrer')

      writeFileSync(source, readFileSync(source, 'utf8').replace('# Getting started', '# Getting started\n\nA new paragraph.'))
      await waitFor('A new paragraph.')

      const mdx = join(root, 'src/content/docs/en/cards.mdx')
      const title = (await extract(readFileSync(mdx, 'utf8'), { file: mdx, parser: 'satteri' })).find(s => s.kind === 'prop')!
      await waitFor('Premiers pas', '/fr/cards/')
      await writeRecord(join(root, 'translations'), 'fr', createRecord({ segment: title, text: 'Les débuts', origin: 'human', updatedAt: '2026-11-02T00:00:00.000Z' }))
      await waitFor('Les débuts', '/fr/cards/')
    }
    finally {
      execFileSync(process.execPath, [astroBin, 'dev', 'stop', '--root', root], { env, stdio: 'ignore' })
    }
  })
})
