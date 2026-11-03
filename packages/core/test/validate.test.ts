import type { Placeholder, ValidationTarget } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { lengthRatio, maxTranslationLength, pseudoTranslate, validate } from '../src/index.ts'

const placeholders: Placeholder[] = [
  { id: 0, type: 'link', source: '[', close: '](/docs)' },
  { id: 1, type: 'code', source: '`useFetch`' },
]
const paragraph: ValidationTarget = { kind: 'paragraph', format: 'markdown', placeholders, skeleton: 'Read {0}the docs{/0} about {1}.' }
const codes = (translation: string, target = paragraph) => validate(translation, target).errors.map(e => e.code)

describe('validate', () => {
  it('should accept a valid translation', () => {
    expect(validate('Lisez {0}la doc{/0} sur **{1}**.', paragraph)).toEqual({ ok: true, errors: [], warnings: [] })
    expect(validate(paragraph.skeleton!, paragraph).ok).toBe(true)
  })

  it('should reject dropped and invented placeholders', () => {
    expect(codes('Lisez la doc sur {1}.')).toContain('missing-placeholder')
    expect(codes('Lisez {0}la doc{/0} sur {1} {2}.')).toContain('unknown-placeholder')
    expect(codes('Lisez {0}la doc{/0} sur {1}{/1}.')).toContain('not-paired')
  })

  it('should warn on repeated code placeholders and reject repeated links', () => {
    const result = validate('{1} を使用すると {0}docs{/0} {1}', paragraph)
    expect(result.ok).toBe(true)
    expect(result.warnings.map(w => w.code)).toEqual(['duplicate-placeholder'])
    expect(codes('{0}a{/0} {0}b{/0} {1}')).toContain('duplicate-placeholder')
  })

  it('should reject smuggled markdown', () => {
    expect(codes('Lisez {0}la doc{/0} sur {1} [Vite](https://example.com).')).toContain('link-syntax')
    expect(codes('{0}a{/0} {1} `x`')).toContain('inline-code')
    expect(codes('{0}a{/0} {1} <img src=x onerror=alert(1)>')).toContain('html')
    expect(codes('{0}a{/0} {1} :badge[x]')).toContain('component')
    expect(codes('{0}a{/0} {1} {{ secret }}')).toContain('binding')
    expect(codes('{0}a{/0} {1} https://evil.example')).toContain('bare-url')
    expect(codes('{0}a{/0} {1}\n\nmore')).toContain('blank-line')
    expect(codes('# {0}a{/0} {1}')).toContain('block-syntax')
    expect(codes('{0}a{/0} {1} &amp;')).toContain('entity')
  })

  it('should accept escaped punctuation', () => {
    expect(validate('{0}a{/0} {1} \\[x\\] \\`y\\` \\<b> \\{z\\}', paragraph).ok).toBe(true)
  })

  it('should reject unbalanced emphasis and crossed nesting', () => {
    expect(codes('**{0}a{/0} {1}')).toContain('unclosed')
    expect(codes('**{0}a**{/0} {1}')).toContain('nesting')
  })

  it('should reject newlines in single-line kinds', () => {
    expect(codes('Titre\nsuite', { kind: 'heading', format: 'markdown', placeholders: [] })).toContain('multiline')
    expect(codes('a | b', { kind: 'table-cell', format: 'markdown', placeholders: [] })).toContain('table-pipe')
  })

  it('should reject markup in plain segments unless the source has it', () => {
    const prop: ValidationTarget = { kind: 'prop', format: 'plain', placeholders: [], skeleton: 'Read more' }
    expect(validate('Lire la suite (plus)', prop).ok).toBe(true)
    expect(codes('Lire **la** suite', prop)).toContain('markup')
    expect(codes('Lire [la](https://x) suite', prop)).toContain('markup')
    expect(codes('Lire <b>la</b> suite', prop)).toContain('markup')
    expect(validate('Utiliser <NuxtLink>', { ...prop, skeleton: 'Use <NuxtLink>' }).ok).toBe(true)
  })

  it('should reject comment terminators and newlines in code comments', () => {
    const comment: ValidationTarget = { kind: 'code-comment', format: 'plain', placeholders: [{ id: 0, type: 'code', source: '`x`' }], skeleton: 'returns {0}' }
    expect(validate('renvoie {0}', comment).ok).toBe(true)
    expect(codes('renvoie {0} */ alert(1)', comment)).toContain('comment-terminator')
    expect(codes('renvoie {0} --> <script>', comment)).toContain('comment-terminator')
    expect(codes('renvoie\n{0}', comment)).toContain('multiline')
    expect(codes('renvoie', comment)).toContain('missing-placeholder')
  })

  it('should check lengths against a locale style and a limit', () => {
    const style = { lengthRatio: [0.8, 1.5] as [number, number] }
    expect(lengthRatio('Lisez {0}la doc{/0}  sur {1}.', paragraph.skeleton!)).toBeCloseTo(18 / 21)
    const long = { ...paragraph, skeleton: 'Read {0}the docs{/0} about {1} before you start.' }
    expect(validate('Lisez {0}la doc{/0} sur {1} avant de commencer.', long, { style })).toEqual({ ok: true, errors: [], warnings: [] })
    expect(validate('Lisez {0}la documentation complète et détaillée{/0} sur {1} avant de commencer.', long, { style })).toMatchObject({ ok: true, warnings: [{ code: 'length' }] })
    expect(validate('Lisez {0}la documentation complète et détaillée{/0} sur {1} avant de commencer.', long, { style: {} }).warnings).toEqual([])
    expect(validate('Lisez {0}la documentation complète et détaillée{/0} sur {1}.', paragraph, { style }).warnings).toEqual([])
    expect(validate('Lisez {0}la doc{/0} sur {1}.', paragraph, { maxLength: 10 })).toMatchObject({ ok: false, errors: [{ code: 'too-long' }] })
    expect(validate('Lisez {0}la doc{/0} sur {1} 🚀🚀.', paragraph, { maxLength: 31 }).ok).toBe(true)
    expect(maxTranslationLength('Hello')).toBe(120)
    expect(maxTranslationLength('🚀')).toBe(104)
    expect(maxTranslationLength('a'.repeat(5000))).toBe(8000)
  })

  it('should accept pseudo translations of every segment shape', () => {
    for (const skeleton of ['**Type**: {1}', '{0}Nitro{/0}, *the* engine \\_x\\_', '1\\. Migrate {0}x{/0} {1}']) {
      const target = { ...paragraph, skeleton }
      const pseudo = pseudoTranslate(skeleton)
      expect(pseudo).not.toBe(skeleton)
      expect(validate(pseudo, target).errors.filter(e => e.code !== 'missing-placeholder')).toEqual([])
    }
    expect(pseudoTranslate('Use {0}the docs{/0} **now**')).toBe('⟦Úsé⟧ {0}⟦thé dócs⟧{/0} **⟦nów⟧**')
  })
})
