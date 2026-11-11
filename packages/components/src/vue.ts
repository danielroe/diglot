import type { SkeletonNode } from '@diglot/core'
import type { App, InjectionKey, Slots, VNodeArrayChildren } from 'vue'
import type { Diglot, DiglotOptions } from './diglot.ts'
import { defineComponent, inject, shallowRef, toDisplayString } from 'vue'
import { createDiglot as createState } from './diglot.ts'

export type { Catalog, Diglot, DiglotOptions } from './diglot.ts'

const key: InjectionKey<Diglot> = Symbol('diglot')

function render(nodes: SkeletonNode[], slots: Slots): VNodeArrayChildren {
  return nodes.map((node) => {
    if (node.type !== 'placeholder')
      return node.type === 'text' ? node.value : null
    const children = node.children
    return slots[node.id]?.(children && { __children: () => render(children, slots) })
  })
}

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
      return () => {
        void version.value
        return render(diglot.nodes(props.h, props.s), slots)
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
