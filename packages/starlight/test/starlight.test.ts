import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { starlightPolicy } from '@diglot/core'
import { extract } from '@diglot/mdast'
import { build } from 'astro'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
let root: string

/** Copies the fixture site next to the original, so that its relative imports still resolve. */
function copyFixture(): string {
  const copy = mkdtempSync(join(fixtures, '.tmp-'))
  cpSync(join(fixtures, 'site'), copy, { recursive: true, filter: path => !/[/\\](?:dist|\.astro|node_modules)$/.test(path) })
  return copy
}

function page(path: string): string {
  return readFileSync(join(root, 'dist', path, 'index.html'), 'utf8')
}

function sidebar(html: string): string[][] {
  const nav = html.slice(html.indexOf('class="sidebar-content'))
  return [...nav.slice(0, nav.indexOf('</nav>')).matchAll(/<a href="([^"]+)"[^>]*>\s*<span[^>]*>([^<]*)/g)].map(([, href, label]) => [href!, label!.trim()])
}

describe('starlightPolicy', () => {
  it('should extract Starlight frontmatter and component props, protect banner HTML and skip file trees', async () => {
    const source = '---\ntitle: Start\nsidebar:\n  label: Begin\n  badge: New\nbanner:\n  content: Read the <a href="/notes/">notes</a>\n---\n\n<LinkCard title="Read more" description="The next page." href="/next/" />\n<TabItem label="npm">Install it.</TabItem>\n\n<FileTree>\n\n- src/\n  - index.md\n\n</FileTree>\n'
    const segments = await extract(source, { format: 'mdx', parser: 'satteri', policy: starlightPolicy })
    expect(segments.map(s => [s.kind, s.context.detail ?? null, s.skeleton])).toEqual([
      ['frontmatter', 'title', 'Start'],
      ['frontmatter', 'sidebar.label', 'Begin'],
      ['frontmatter', 'sidebar.badge', 'New'],
      ['frontmatter', 'banner.content', 'Read the {0}notes{/0}'],
      ['prop', 'title', 'Read more'],
      ['prop', 'description', 'The next page.'],
      ['prop', 'label', 'npm'],
      ['component-slot', null, 'Install it.'],
    ])
  })
})

describe('diglot for Starlight', () => {
  beforeAll(async () => {
    root = copyFixture()
    await build({ root, logLevel: 'error' })
  }, 60_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('should translate Markdown pages, their asides and their sidebar labels', () => {
    const html = page('fr/guides/basics')
    expect(html).toMatch(/<h1 id="_top"[^>]*>Les bases<\/h1>/)
    expect(html).toContain('Chaque page commence ici.')
    expect(html).toMatch(/Le saviez-vous \?[\s\S]*Les encadrés sont traduits aussi\./)
    expect(sidebar(html)).toEqual([
      ['/fr/guides/basics/', 'Les bases'],
      ['/fr/guides/components/', 'Composants'],
      ['/fr/guides/structure/', 'Structure'],
      ['/fr/guides/untranslated/', 'Untranslated'],
    ])
    expect(sidebar(page('guides/basics')).map(([href]) => `/fr${href}`)).toEqual(sidebar(html).map(([href]) => href))
  })

  it('should translate MDX pages and the props of Starlight components', () => {
    const html = page('fr/guides/components')
    expect(html).toContain('Les composants Starlight fonctionnent dans les traductions.')
    expect(html).toMatch(/Lire les bases[\s\S]*Commencez par le premier guide\./)
    expect([...html.matchAll(/role="tab" href[^>]*>([^<]*)/g)].map(([, label]) => label)).toEqual(['Installer', 'Configurer'])
    expect(html).toMatch(/Lancez l’installeur\.[\s\S]*Modifiez la configuration\./)
  })

  it('should link translated pages to their source for editing', () => {
    expect(page('fr/guides/basics')).toContain('href="https://github.com/example/docs/edit/main/src/content/docs/guides/basics.md"')
    expect(page('fr/guides/components')).toContain('href="https://github.com/example/docs/edit/main/src/content/docs/guides/components.mdx"')
    expect(page('fr')).toContain('href="https://example.com/edit/home/"')
  })

  it('should date translated pages by their newest record', () => {
    expect(page('fr/guides/basics')).toContain('datetime="2026-10-22T08:00:00.000Z"')
    expect(page('fr/guides/components')).toContain('datetime="2026-10-21T08:00:00.000Z"')
    expect(page('fr')).toContain('datetime="2020-01-02T00:00:00.000Z"')
  })

  it('should translate the steps, badges and icons of Starlight and keep file trees', () => {
    const html = page('fr/guides/structure')
    expect(html).toMatch(/class="sl-steps"[\s\S]*Créez un projet\.[\s\S]*Ajoutez le plugin\./)
    expect(html).toMatch(/<starlight-file-tree[\s\S]*src[\s\S]*index\.md/)
    expect(html).toContain('Nouveau')
    expect(html).toContain('aria-label="Étoile"')
  })

  it('should leave untranslated pages to the fallback of Starlight', () => {
    const html = page('fr/guides/untranslated')
    expect(html).toContain('Ce contenu n’est pas encore disponible dans votre langue.')
    expect(html).toContain('Nobody translated this page.')
  })
})
