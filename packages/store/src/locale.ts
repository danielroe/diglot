import type { Glossary, LocaleState, LocaleStyle } from '@diglot/core'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'pathe'
import { parse as parseYaml } from 'yaml'
import { mergeGlossary, parseGlossary, parseLocaleState, parseStyle } from './locale-data.ts'

export interface LoadGlossaryOptions {
  /** Glossary shared by every locale (relative to `root` or absolute), merged below `<locale>/glossary.yml`. */
  shared?: string
}

/**
 * Reads the glossary of a locale: the shared glossary, if any, overridden term by term by
 * `<locale>/glossary.yml`. Returns `undefined` when neither exists.
 */
export async function loadGlossary(root: string, locale: string, options: LoadGlossaryOptions = {}): Promise<Glossary | undefined> {
  const sharedPath = options.shared && (isAbsolute(options.shared) ? options.shared : join(root, options.shared))
  const shared = sharedPath ? await readData(sharedPath) : undefined
  const own = await readData(join(root, locale, 'glossary.yml'))
  return mergeGlossary(
    shared === undefined ? undefined : parseGlossary(shared, locale, options.shared),
    own === undefined ? undefined : parseGlossary(own, locale, `${locale}/glossary.yml`),
  )
}

/** Reads `<locale>/locale.yml`, or an empty state when there is none. */
export async function loadLocaleState(root: string, locale: string): Promise<LocaleState> {
  return parseLocaleState(await readData(join(root, locale, 'locale.yml')), `${locale}/locale.yml`)
}

/** Reads `<locale>/style.yml`, or `undefined` when there is none. */
export async function loadStyle(root: string, locale: string): Promise<LocaleStyle | undefined> {
  const data = await readData(join(root, locale, 'style.yml'))
  return data === undefined ? undefined : parseStyle(data, `${locale}/style.yml`)
}

async function readData(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  if (content === undefined)
    return
  return path.endsWith('.json') ? JSON.parse(content) : parseYaml(content) ?? {}
}
