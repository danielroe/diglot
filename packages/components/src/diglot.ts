import type { Placeholder, SkeletonNode } from '@diglot/core'
import { parseSkeleton } from '@diglot/core'

/** Translated skeletons by segment hash, as the Vite plugin builds them from the records of a locale. */
export type Catalog = Readonly<Record<string, string>>

export interface DiglotOptions {
  /** The locale the components are written in. Defaults to `en`. */
  sourceLocale?: string
  /** The locale to start in. Defaults to the source locale. */
  locale?: string
  /** Catalog loaders by locale. `virtual:diglot` exports them. */
  locales?: Readonly<Record<string, () => Promise<Catalog>>>
  /** Catalogs already loaded, by locale. */
  messages?: Readonly<Record<string, Catalog>>
}

/** Renders a segment as text, with `values` in place of its placeholders. */
export type Translate = (hash: string, source: string, values?: readonly unknown[]) => string

export interface Diglot {
  readonly sourceLocale: string
  readonly locale: string
  /**
   * The locale the instance was created in. A server render with the same options is in this
   * locale, so React hydrates in it before it switches to `locale`.
   */
  readonly initialLocale: string
  /** Every locale with a catalog, the source locale first. */
  readonly locales: string[]
  /** Settles once the catalog of the starting locale is loaded. Await it before a server render. */
  readonly ready: Promise<void>
  /** Loads the catalog of a locale if needed, then switches to it, unless a later call asked for another locale. */
  setLocale: (locale: string) => Promise<void>
  /** A segment as text in the current locale, or in `locale`. */
  t: (hash: string, source: string, values?: readonly unknown[], locale?: string) => string
  /** A segment as text and placeholder nodes in the current locale, or in `locale`. */
  nodes: (hash: string, source: string, locale?: string) => SkeletonNode[]
  /** Replaces the catalog of a locale, as hot updates do when a record changes. */
  update: (locale: string, catalog: Catalog) => void
  /** Calls `listener` after the locale or its catalog changes. Returns a function that unsubscribes. */
  subscribe: (listener: () => void) => () => void
}

/** Where instances in the browser register, so that `virtual:diglot` can send them hot updates. */
const INSTANCES = Symbol.for('@diglot/components')

const display = (value: unknown) => value == null ? '' : String(value)

/**
 * A key for each node, the same for a placeholder wherever a translation moves it, so that a
 * framework keeps the state of what it renders. A repeated placeholder gets a key per occurrence.
 */
export function keys(nodes: SkeletonNode[]): string[] {
  const seen = new Map<number, number>()
  return nodes.map((node, i) => {
    if (node.type !== 'placeholder')
      return `t${i}`
    const occurrence = seen.get(node.id) ?? 0
    seen.set(node.id, occurrence + 1)
    return occurrence ? `${node.id}.${occurrence}` : `${node.id}`
  })
}

function parse(skeleton: string): SkeletonNode[] {
  const paired = [...skeleton.matchAll(/\{\/(\d+)\}/g)].map((match): Placeholder => ({ id: Number(match[1]), type: 'html', source: '', close: '' }))
  return parseSkeleton(skeleton, paired, 'plain')
}

/**
 * Creates the locale state that the framework runtimes subscribe to. Create one per app, and on the
 * server one per request, so that requests never share a locale.
 */
export function createDiglot(options: DiglotOptions = {}): Diglot {
  const sourceLocale = options.sourceLocale ?? 'en'
  const initialLocale = options.locale ?? sourceLocale
  let locale = initialLocale
  let requested = initialLocale
  const catalogs = new Map(Object.entries(options.messages ?? {}))
  const loaders = new Map(Object.entries(options.locales ?? {}))
  const loading = new Map<string, Promise<void>>()
  const listeners = new Set<() => void>()
  const parsed = new Map<string, SkeletonNode[]>()
  const changed = () => listeners.forEach(listener => listener())

  /** The skeleton to render: the translation with the whitespace around the source, or the source. */
  function skeleton(hash: string, source: string, at: string): string {
    const translation = at === sourceLocale ? undefined : catalogs.get(at)?.[hash]
    if (translation === undefined)
      return source
    return source.match(/^\s*/)![0] + translation + source.match(/\s*$/)![0]
  }

  /** Loads the catalog of a locale once. Throws right away for a locale without one, so that `createDiglot` does too. */
  function load(next: string): Promise<void> {
    if (next === sourceLocale || catalogs.has(next))
      return Promise.resolve()
    const loader = loaders.get(next)
    if (!loader)
      throw new Error(`no catalog for the locale "${next}"`)
    let promise = loading.get(next)
    if (!promise) {
      promise = loader().then((catalog) => {
        catalogs.set(next, catalog)
        if (next === locale)
          changed()
      }, (error) => {
        loading.delete(next)
        throw error
      })
      loading.set(next, promise)
    }
    return promise
  }

  const ready = load(locale)
  // Rejections of `ready` belong to whoever awaits it.
  ready.catch(() => {})
  const diglot: Diglot = {
    sourceLocale,
    initialLocale,
    ready,
    get locale() {
      return locale
    },
    get locales() {
      return [sourceLocale, ...new Set([...loaders.keys(), ...catalogs.keys()].filter(l => l !== sourceLocale))]
    },
    async setLocale(next) {
      const loaded = load(next)
      requested = next
      await loaded
      if (next !== requested || next === locale)
        return
      locale = next
      changed()
    },
    t(hash, source, values, at = locale) {
      const text = skeleton(hash, source, at)
      return values ? text.replace(/\{(\d+)\}/g, (match, id: string) => id in values ? display(values[Number(id)]) : match) : text
    },
    nodes(hash, source, at = locale) {
      const text = skeleton(hash, source, at)
      let nodes = parsed.get(text)
      if (!nodes)
        parsed.set(text, nodes = parse(text))
      return nodes
    },
    update(next, catalog) {
      catalogs.set(next, catalog)
      if (next === locale)
        changed()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  if (typeof window !== 'undefined')
    ((globalThis as { [INSTANCES]?: Set<WeakRef<Diglot>> })[INSTANCES] ??= new Set()).add(new WeakRef(diglot))
  return diglot
}
