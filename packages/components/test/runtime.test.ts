// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, onMounted, ref, resolveComponent } from 'vue'
import { createDiglot } from '../src/diglot.ts'
import { createDiglot as createVueDiglot, useDiglot } from '../src/vue.ts'

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
    expect(() => createDiglot({ locale: 'de' })).toThrow('no catalog for the locale "de"')
  })

  it('should switch to the locale of the last call, and load each catalog once', async () => {
    const slow = vi.fn(() => new Promise<Record<string, string>>(resolve => setTimeout(resolve, 20, { abc: 'Bonjour' })))
    const diglot = createDiglot({ locales: { fr: slow, de: async () => ({ abc: 'Hallo' }) } })
    await Promise.all([diglot.setLocale('fr'), diglot.setLocale('de'), diglot.setLocale('fr')])
    expect(diglot.locale).toBe('fr')
    expect(slow).toHaveBeenCalledOnce()
    await Promise.all([diglot.setLocale('fr'), diglot.setLocale('de')])
    expect(diglot.locale).toBe('de')
  })

  it('should keep loading a locale when a locale without a catalog is asked for', async () => {
    const diglot = createDiglot({ locales: { fr: async () => ({ abc: 'Bonjour' }) } })
    const fr = diglot.setLocale('fr')
    await expect(diglot.setLocale('xx')).rejects.toThrow('no catalog for the locale "xx"')
    await fr
    expect(diglot.locale).toBe('fr')
  })

  it('should leave a failed starting catalog to whoever awaits `ready`', async () => {
    const diglot = createDiglot({ locale: 'fr', locales: { fr: () => Promise.reject(new Error('offline')) } })
    await expect(diglot.ready).rejects.toThrow('offline')
  })

  it('should retry a catalog that failed to load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ abc: 'Bonjour' })
    const diglot = createDiglot({ locales: { fr: load } })
    await expect(diglot.setLocale('fr')).rejects.toThrow('offline')
    await diglot.setLocale('fr')
    expect(diglot.t('abc', 'Hello')).toBe('Bonjour')
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

  it('should keep the state of components inside an element when its catalog changes', async () => {
    let mounted = 0
    const Badge = defineComponent({ setup: () => onMounted(() => mounted++), render: () => h('i', 'new') })
    const Text = defineComponent({
      render: () => h(resolveComponent('DiglotText'), { h: 'abc', s: 'Read {0}the docs {1}{/0}' }, {
        0: ({ __children }: { __children: () => unknown }) => h('a', h(__children)),
        1: () => h(Badge),
      }),
    })
    const diglot = createVueDiglot({ locale: 'fr', messages: { fr: { abc: 'Lisez {0}la doc {1}{/0}' } } })
    const root = document.createElement('div')
    createApp(Text).use(diglot).mount(root)
    diglot.update('fr', { abc: 'Lisez {0}la doc {1}{/0}', other: 'Autre' })
    await nextTick()
    diglot.update('fr', { abc: 'Lisez {0}la doc {1}{/0}' })
    await nextTick()
    expect(root.innerHTML).toBe('Lisez <a>la doc <i>new</i></a>')
    expect(mounted).toBe(1)
  })

  it('should keep the elements of components inside an element when the parent renders again', async () => {
    const count = ref(0)
    const Text = defineComponent({
      render: () => h('p', [h(resolveComponent('DiglotText'), { h: 'abc', s: 'Hello {0}world {1}{/0}' }, {
        0: ({ __children }: { __children: () => unknown }) => h('b', h(__children)),
        1: () => h('input'),
      }), ` ${count.value}`]),
    })
    const root = document.createElement('div')
    createApp(Text).use(createVueDiglot()).mount(root)
    const input = root.querySelector('input')
    count.value++
    await nextTick()
    expect(root.innerHTML).toBe('<p>Hello <b>world <input></b> 1</p>')
    expect(root.querySelector('input')).toBe(input)
  })
})
