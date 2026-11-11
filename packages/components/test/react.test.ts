// @vitest-environment happy-dom
import { hashSkeleton } from '@diglot/core'
import { act, createElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { createDiglot, DiglotProvider, DiglotText, useTranslate } from '../src/react.ts'

function Values() {
  return createElement('option', null, useTranslate()('abc', 'Hello {0}{1}{2}', [false, ['Ada', 'Bob'], new Set([1, 2])]))
}

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const source = 'Your inbox'
const hash = hashSkeleton(source, undefined, 'plain')
const messages = { fr: { [hash]: 'Votre boîte' } }

function Inbox() {
  const t = useTranslate()
  return createElement('p', { title: t(hash, source) }, createElement(DiglotText, { h: hash, s: source }))
}

it('should render placeholders from React nodes in the locale of the provider', () => {
  const html = (locale: string) => renderToString(createElement(
    DiglotProvider,
    { diglot: createDiglot({ locale, messages: { fr: { abc: 'Salut {0}{1}{/1}' } } }) },
    createElement(DiglotText, { h: 'abc', s: 'Hi {0}, {1}welcome{/1}', p: [createElement('i', null, 'Ada'), (children: unknown) => createElement('b', null, children as string)] }),
  ))
  expect(html('en')).toBe('Hi <i>Ada</i>, <b>welcome</b>')
  expect(html('fr')).toBe('Salut <i>Ada</i><b></b>')
})

it('should hydrate in the initial locale after an earlier `setLocale`, then show the current one', async () => {
  const container = document.createElement('div')
  container.innerHTML = renderToString(createElement(DiglotProvider, { diglot: createDiglot({ messages }) }, createElement(Inbox)))
  expect(container.innerHTML).toBe('<p title="Your inbox">Your inbox</p>')

  const diglot = createDiglot({ messages })
  await diglot.setLocale('fr')
  const errors = vi.fn()
  await act(async () => {
    hydrateRoot(container, createElement(DiglotProvider, { diglot }, createElement(Inbox)), { onRecoverableError: errors })
  })
  expect(errors).not.toHaveBeenCalled()
  expect(container.innerHTML).toBe('<p title="Votre boîte">Votre boîte</p>')
})

it('should render values in text as React does', () => {
  expect(renderToString(createElement(Values))).toBe('<option>Hello AdaBob12</option>')
})

it('should keep the state of placeholders that a translation reorders', async () => {
  const diglot = createDiglot({ locale: 'fr', messages: { fr: { abc: 'First {0} second {1}' } } })
  const container = document.createElement('div')
  const field = (id: string) => createElement('input', { id })
  await act(async () => {
    createRoot(container).render(createElement(DiglotProvider, { diglot }, createElement(DiglotText, { h: 'abc', s: 'First {0} second {1}', p: [field('a'), field('b')] })))
  })
  container.querySelector<HTMLInputElement>('#a')!.value = 'Ada'
  await act(async () => diglot.update('fr', { abc: 'Second {1} first {0}' }))
  expect(container.querySelector<HTMLInputElement>('#a')!.value).toBe('Ada')
  expect(container.textContent).toBe('Second  first ')
})
