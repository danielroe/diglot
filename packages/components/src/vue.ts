import type { SkeletonNode } from '@diglot/core'
import type { App, InjectionKey, VNodeArrayChildren } from 'vue'
import type { Diglot, DiglotOptions } from './diglot.ts'
import { defineComponent, Fragment, h, inject, shallowReactive, shallowRef, toDisplayString } from 'vue'
import { createDiglot as createState, keys } from './diglot.ts'

export type { Catalog, Diglot, DiglotOptions } from './diglot.ts'

const key: InjectionKey<Diglot> = Symbol('diglot')

/**
 * Creates the locale state and a Vue plugin that installs it: rewritten templates call `$diglot`
 * for text and render `<DiglotText>` for text with elements, and both re-render when the locale or
 * its catalog changes.
 */
export function createDiglot(options: DiglotOptions = {}): Diglot & { install: (app: App) => void } {
  const diglot = createState(options)
  // A render that reads `version` re-runs when the locale or its catalog changes.
  const version = shallowRef(0)
  diglot.subscribe(() => version.value++)
  const DiglotText = defineComponent({
    name: 'DiglotText',
    props: {
      h: { type: String, required: true },
      s: { type: String, required: true },
    },
    setup(props, { slots }) {
      // One component per paired placeholder, rendering the nodes it wraps in the current translation, so that the components inside it keep their state.
      const wrapped = shallowReactive(new Map<number, SkeletonNode[]>())
      const wrappers = new Map<number, () => VNodeArrayChildren>()
      function wrap(id: number, nodes: SkeletonNode[]) {
        wrapped.set(id, nodes)
        let wrapper = wrappers.get(id)
        if (!wrapper)
          wrappers.set(id, wrapper = () => render(wrapped.get(id)!))
        return wrapper
      }
      function render(nodes: SkeletonNode[]): VNodeArrayChildren {
        const keyed = keys(nodes)
        return nodes.map((node, i) => {
          if (node.type !== 'placeholder')
            return node.type === 'text' ? node.value : null
          return h(Fragment, { key: keyed[i] }, slots[node.id]?.(node.children && { __children: wrap(node.id, node.children) }))
        })
      }
      return () => {
        void version.value
        return render(diglot.nodes(props.h, props.s))
      }
    },
  })
  // Reading `locale` in a render tracks it too, for locale switchers.
  const tracked = new Proxy(diglot, {
    get(target, property, receiver) {
      if (property === 'locale')
        void version.value
      return Reflect.get(target, property, receiver)
    },
  })
  return Object.assign(tracked, {
    install(app: App) {
      app.config.globalProperties.$diglot = (hash: string, source: string, values?: unknown[]) => {
        void version.value
        return diglot.t(hash, source, values?.map(toDisplayString))
      }
      app.provide(key, tracked)
      app.component('DiglotText', DiglotText)
    },
  })
}

/** The locale state of the app, for a locale switcher. */
export function useDiglot(): Diglot {
  return inject(key)!
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $diglot: (hash: string, source: string, values?: unknown[]) => string
  }
}
