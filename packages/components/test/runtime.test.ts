// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createDiglot } from '../src/runtime/diglot.ts'
import { createDiglot as createVueDiglot, useDiglot } from '../src/runtime/vue.ts'

describe('createDiglot', () => {
  it('should keep the whitespace of the source around a translation', () => {
    const diglot = createDiglot({ locale: 'fr', messages: { fr: { abc: 'Bonjour {0}' } } })
    expect(diglot.t('abc', ' Hello {0} ', ['Ada'])).toBe(' Bonjour Ada ')
    expect(diglot.t('abc', ' Hello {0} ', ['Ada'], 'en')).toBe(' Hello Ada ')
  })

  it('should load the catalog of a locale when it switches to it', async () => {
    const load = vi.fn(async () => ({ abc: 'Bonjour' }))
    const diglot = createDiglot({ locales: { fr: load } })
    const listener = vi.fn()
    diglot.subscribe(listener)
    expect(diglot.locales).toEqual(['en', 'fr'])
    await diglot.setLocale('fr')
    await diglot.setLocale('fr')
    expect(load).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
    expect(diglot.t('abc', 'Hello')).toBe('Bonjour')
    await expect(diglot.setLocale('de')).rejects.toThrow('no catalog for the locale "de"')
  })

  it('should parse a translation into text and placeholder nodes', () => {
    const diglot = createDiglot({ locale: 'fr', messages: { fr: { abc: 'Lisez {0}la doc{/0}{1}' } } })
    expect(diglot.nodes('abc', 'Read {0}the docs{/0}{1}')).toEqual([
      { type: 'text', value: 'Lisez ' },
      { type: 'placeholder', id: 0, children: [{ type: 'text', value: 'la doc' }] },
      { type: 'placeholder', id: 1 },
    ])
  })
})

describe('vue', () => {
  it('should re-render text and a locale switcher when the locale changes', async () => {
    const Switcher = defineComponent({
      setup: () => ({ diglot: useDiglot() }),
      render() {
        return h('p', `${this.diglot.locale}: ${this.$diglot('abc', 'Hello')}`)
      },
    })
    const diglot = createVueDiglot({ messages: { fr: { abc: 'Bonjour' } } })
    const root = document.createElement('div')
    createApp(Switcher).use(diglot).mount(root)
    expect(root.innerHTML).toBe('<p>en: Hello</p>')
    await diglot.setLocale('fr')
    await nextTick()
    expect(root.innerHTML).toBe('<p>fr: Bonjour</p>')
  })
})
