import type { DefaultTreeAdapterMap } from 'parse5'
import type { InlineConfig } from 'vite'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRecord, pseudoTranslate } from '@diglot/core'
import { writeRecord } from '@diglot/store'
import { parseFragment } from 'parse5'
import { extract, isComponent } from '../src/index.ts'

type Node = DefaultTreeAdapterMap['childNode']

export const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

export function runtime(framework: 'react' | 'svelte' | 'vue'): string {
  return fileURLToPath(new URL(`../src/runtime/${framework}.ts`, import.meta.url))
}

/** The components of a fixture directory, sorted. */
export function components(dir: string): string[] {
  return readdirSync(dir).filter(isComponent).sort()
}

/** Options for a Vite server that only loads modules. */
export function quiet(root: string, framework: 'react' | 'svelte' | 'vue'): InlineConfig {
  return {
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    configFile: false,
    root,
    resolve: { alias: { [`@diglot/components/${framework}`]: runtime(framework) } },
  }
}

/** A translations repository with a pseudo translation of every segment of the components in `dir`, for `fr`. */
export async function pseudoTranslations(dir: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'diglot-components-'))
  writeFileSync(join(root, 'diglot.config.ts'), `export default { locales: ['fr'] }\n`)
  for (const file of components(dir)) {
    for (const segment of await extract(readFileSync(join(dir, file), 'utf8'), { file }))
      await writeRecord(root, 'fr', createRecord({ segment, text: pseudoTranslate(segment.skeleton, 'plain'), origin: 'mt' }))
  }
  return root
}

/** Text without the marks of `pseudoTranslate`, and with whitespace collapsed as in a segment. */
export function unpseudo(text: string): string {
  return text.normalize('NFD').replace(/[\u0301⟦⟧]/g, '').normalize('NFC').replace(/[^\S\u00A0]+/g, ' ')
}

/** A canonical form of a rendered page: no comments, adjacent text merged, attributes sorted. */
export function canonical(html: string, map: (text: string) => string = text => text): string {
  const out: string[] = []
  const walk = (nodes: Node[]) => {
    let text = ''
    const flush = () => {
      if (text)
        out.push(JSON.stringify(map(text)))
      text = ''
    }
    for (const node of nodes) {
      if (node.nodeName === '#comment')
        continue
      if (node.nodeName === '#text') {
        text += (node as DefaultTreeAdapterMap['textNode']).value
        continue
      }
      flush()
      const element = node as DefaultTreeAdapterMap['element']
      out.push(`<${element.tagName}${element.attrs.map(a => ` ${a.name}=${JSON.stringify(map(a.value))}`).sort().join('')}>`)
      walk(element.tagName === 'template' ? (element as DefaultTreeAdapterMap['template']).content.childNodes : element.childNodes)
      out.push(`</${element.tagName}>`)
    }
    flush()
  }
  walk(parseFragment(html).childNodes as Node[])
  return out.join('\n')
}
