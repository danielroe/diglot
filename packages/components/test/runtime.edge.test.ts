import { expect, it } from 'vitest'
import { createDiglot } from '../src/diglot.ts'

it('should run without Node built-ins', () => {
  const diglot = createDiglot({ locale: 'fr', messages: { fr: { abc: 'Bonjour {0}' } } })
  expect(diglot.t('abc', 'Hello {0}', ['Ada'])).toBe('Bonjour Ada')
  expect(diglot.nodes('abc', 'Hello {0}')).toEqual([{ type: 'text', value: 'Bonjour ' }, { type: 'placeholder', id: 0 }])
})
