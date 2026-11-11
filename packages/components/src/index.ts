import type { Policy, Segment } from '@diglot/core'
import type { Parsed, Transformed } from './markup.ts'
import { transformMarkup } from './markup.ts'
import { parseReact } from './react.ts'
import { parseSvelte } from './svelte.ts'
import { parseVue } from './vue.ts'

export type { Skipped, Transformed } from './markup.ts'

const parsers: Record<string, (code: string, file: string) => Promise<Parsed | undefined>> = {
  vue: parseVue,
  svelte: parseSvelte,
  jsx: parseReact,
  tsx: parseReact,
}

export interface ExtractOptions {
  /** File path recorded in segment contexts. Its extension picks the parser. */
  file: string
  policy?: Partial<Policy>
}

/** File extensions of the components this package reads. */
export const extensions = Object.keys(parsers)

/** Whether `file` is a component this package reads, by its extension. Queries are ignored. */
export function isComponent(file: string): boolean {
  return parserOf(file) !== undefined
}

/**
 * Extracts the segments of a component and rewrites it to render them through the runtime of its
 * framework. Returns `undefined` for files it does not read and for components without a template.
 */
export async function transform(code: string, options: ExtractOptions): Promise<Transformed | undefined> {
  const parsed = await parserOf(options.file)?.(code, options.file)
  return parsed && transformMarkup(code, options.file, parsed, options.policy)
}

/** Extracts the segments of a component, in the order they appear. */
export async function extract(code: string, options: ExtractOptions): Promise<Segment[]> {
  return (await transform(code, options))?.segments ?? []
}

function parserOf(file: string) {
  return parsers[file.replace(/[?#].*$/, '').split('.').at(-1)!]
}
