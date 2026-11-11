import type { SkeletonNode } from '@diglot/core'
import type { Readable } from 'svelte/store'
import type { Diglot, Translate } from './diglot.ts'
import { getContext, hasContext, setContext } from 'svelte'
import { readable } from 'svelte/store'
import { createDiglot } from './diglot.ts'

export { createDiglot }
export type { Catalog, Diglot, DiglotOptions, Translate } from './diglot.ts'
export { default as DiglotText } from './Text.svelte'

/** Renders segments in one locale: as text, and as nodes for `<DiglotText>`. */
export interface Translator extends Translate {
  nodes: (hash: string, source: string) => SkeletonNode[]
}

const key = Symbol('diglot')
let fallback: Diglot | undefined

/** Makes `diglot` the instance of this component and its descendants. Call it in the root component. */
export function setDiglot(diglot: Diglot): Diglot {
  setContext(key, diglot)
  return diglot
}

/** The instance in context. Without one, components share one instance per module. */
export function getDiglot(): Diglot {
  return hasContext(key) ? getContext(key) : fallback ??= createDiglot()
}

/** A store of the current locale's translator, which rewritten components read. */
export function translate(): Readable<Translator> {
  const diglot = getDiglot()
  const translator = (): Translator => Object.assign((hash: string, source: string, values?: readonly unknown[]) => diglot.t(hash, source, values), {
    nodes: (hash: string, source: string) => diglot.nodes(hash, source),
  })
  return readable(translator(), set => diglot.subscribe(() => set(translator())))
}
