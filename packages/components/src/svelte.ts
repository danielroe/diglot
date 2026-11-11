import type { SkeletonNode } from '@diglot/core'
import type { Component, Snippet } from 'svelte'
import type { Readable } from 'svelte/store'
import type { Diglot, Translate } from './diglot.ts'
import { getContext, hasContext, setContext } from 'svelte'
import { readable } from 'svelte/store'
import { createDiglot } from './diglot.ts'
import Text from './Text.svelte'

export { createDiglot }
export type { Catalog, Diglot, DiglotOptions, Translate } from './diglot.ts'

/** Renders segments in one locale: as text, and as nodes for `<DiglotText>`. */
export interface Translator extends Translate {
  nodes: (hash: string, source: string) => SkeletonNode[]
}

/** A segment with elements: `t` the translator, `h` its hash, `s` its source, and a snippet `__p<id>` for each placeholder. */
export interface DiglotTextProps {
  t: Translator
  h: string
  s: string
  [part: `__p${number}`]: Snippet<[Snippet]> | Snippet
}

export const DiglotText: Component<DiglotTextProps> = Text

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
