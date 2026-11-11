import type { SkeletonNode } from '@diglot/core'
import type { ReactElement, ReactNode } from 'react'
import type { Diglot, Translate } from './diglot.ts'
import { createContext, createElement, Fragment, useCallback, useContext, useSyncExternalStore } from 'react'
import { createDiglot, keys } from './diglot.ts'

export { createDiglot }
export type { Catalog, Diglot, DiglotOptions, Translate } from './diglot.ts'

const Context = createContext<Diglot | undefined>(undefined)
let fallback: Diglot | undefined

interface Version {
  value: number
  get: () => number
  getServerSnapshot: () => number
  subscribe: (listener: () => void) => () => void
}

const versions = new WeakMap<Diglot, Version>()

// While React hydrates, it reads the server snapshot. The server rendered the page in the initial
// locale, so components render in it until hydration ends and then again in the current locale. A
// `setLocale` before hydration, such as a locale switcher's, never makes the first render differ from the HTML.
// Without one, both snapshots match, so hydration renders once.
const HYDRATING = -1
const server = typeof window === 'undefined'

/** The instance in scope, a version that changes with its locale and catalog, and the locale to render in, `undefined` for the current one. */
function useSubscription(): [Diglot, number, string | undefined] {
  const diglot = useContext(Context) ?? (fallback ??= createDiglot())
  let version = versions.get(diglot)
  if (!version) {
    const created: Version = {
      value: 0,
      get: () => created.value,
      getServerSnapshot: () => server || diglot.locale === diglot.initialLocale ? created.value : HYDRATING,
      subscribe: listener => diglot.subscribe(listener),
    }
    diglot.subscribe(() => created.value++)
    versions.set(diglot, version = created)
  }
  const value = useSyncExternalStore(version.subscribe, version.get, version.getServerSnapshot)
  return [diglot, value, value === HYDRATING ? diglot.initialLocale : undefined]
}

/** Provides `diglot` to the components below. Without a provider, components share one instance per module. */
export function DiglotProvider({ diglot, children }: { diglot: Diglot, children?: ReactNode }): ReactElement {
  return createElement(Context.Provider, { value: diglot }, children)
}

/** The instance in scope, re-rendering the component when its locale or catalog changes. */
export function useDiglot(): Diglot {
  return useSubscription()[0]
}

/** Renders segments as text in the current locale, for attributes. */
export function useTranslate(): Translate {
  const [diglot, version, locale] = useSubscription()
  return useCallback((hash, source, values) => diglot.t(hash, source, values?.map(text), locale), [diglot, version, locale])
}

/** A value as React renders it in text. */
function text(value: unknown): string {
  if (value == null || typeof value === 'boolean')
    return ''
  if (typeof value === 'object' && Symbol.iterator in value)
    return Array.from(value as Iterable<unknown>, text).join('')
  return String(value)
}

/** Renders a placeholder: an atomic one as a node, a paired one as a function of the text it wraps. */
export type Part = ReactNode | ((children: ReactNode) => ReactNode)

function render(nodes: SkeletonNode[], parts: Part[]): ReactNode {
  const keyed = keys(nodes)
  return createElement(Fragment, null, ...nodes.map((node, i): ReactNode => {
    if (node.type === 'text')
      return node.value
    if (node.type !== 'placeholder')
      return null
    const part = parts[node.id]
    return createElement(Fragment, { key: keyed[i] }, node.children ? (part as (children: ReactNode) => ReactNode)(render(node.children, parts)) : part as ReactNode)
  }))
}

/** A segment: `h` its hash, `s` its source, `p` its placeholders by id. */
export function DiglotText({ h, s, p = [] }: { h: string, s: string, p?: Part[] }): ReactNode {
  const [diglot, , locale] = useSubscription()
  return render(diglot.nodes(h, s, locale), p)
}
