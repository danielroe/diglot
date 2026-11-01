import { describe, expect, it } from 'vitest'
import { applyCode, extractCode, findComments, isProseComment, resolveLanguage } from '../src/index.ts'

const texts = (code: string, language: string) => findComments(code, language).map(c => c.text)

describe('findComments', () => {
  it('should find line, trailing and block comments in TypeScript', () => {
    const code = [
      '// Fetch the data first',
      'const a = 1 // the answer to everything',
      '/**',
      ' * Documented function here.',
      ' * @param x the value',
      ' */',
      'function f() { /* inline block note */ }',
    ].join('\n')
    expect(texts(code, 'ts')).toEqual(['Fetch the data first', 'the answer to everything', 'Documented function here.', 'inline block note'])
  })

  it('should ignore comment markers inside strings, templates and regular expressions', () => {
    const code = [
      'const url = "http://example.com // not a comment"',
      'const single = \'/* nor this */\'',
      'const re = /\\/\\/ not either/g',
      // eslint-disable-next-line no-template-curly-in-string
      'const t = `template // nope ${fn(/* inside an expression */)} done`',
      'const ratio = a / b // divided by two things',
    ].join('\n')
    expect(texts(code, 'js')).toEqual(['inside an expression', 'divided by two things'])
  })

  it('should exclude twoslash directives, tool pragmas and commented-out code', () => {
    const code = [
      '// ^?',
      '// @errors: 2322',
      '// @filename: server/api/hello.ts',
      '// ---cut---',
      '// eslint-disable-next-line no-console',
      '// @ts-expect-error missing types here',
      '// const commented = out()',
      '// server/api/hello.ts',
      '// https://nuxt.com/docs',
      'console.log(1) // [!code highlight]',
      'foo() // highlight this line [!code ++]',
    ].join('\n')
    expect(texts(code, 'ts')).toEqual(['highlight this line'])
  })

  it('should scan script and style blocks of Vue and HTML files', () => {
    const code = [
      '<template>',
      '  <!-- Render the page here -->',
      '  <div>// not a comment</div>',
      '</template>',
      '<script setup lang="ts">',
      '// Fetch the data first',
      '</script>',
      '<style lang="scss">',
      '// Make it pretty please',
      '/* And keep it tidy */',
      '</style>',
    ].join('\n')
    expect(texts(code, 'vue')).toEqual(['Render the page here', 'Fetch the data first', 'Make it pretty please', 'And keep it tidy'])
    expect(texts('<p>Hi</p>\n<!-- Explain the markup -->', 'html')).toEqual(['Explain the markup'])
  })

  it('should scan hash comments in shell, YAML and dotenv', () => {
    expect(texts('#!/bin/bash\n# Install the deps now\nnpm i # run the install\necho "# not a comment" $#', 'bash')).toEqual(['Install the deps now', 'run the install'])
    expect(texts('key: value # explain the key\nurl: "http://x#frag" # second comment here', 'yaml')).toEqual(['explain the key', 'second comment here'])
    expect(texts('# Public base URL\nNUXT_PUBLIC_URL=https://x', 'dotenv')).toEqual(['Public base URL'])
  })

  it('should scan JSON5 and CSS comments', () => {
    expect(texts('{\n  // Enable the feature\n  "a": "// no"\n}', 'json5')).toEqual(['Enable the feature'])
    expect(texts('a { color: red; /* Brand colour here */ }\n// not css', 'css')).toEqual(['Brand colour here'])
  })

  it('should report positions of the comment text', () => {
    const code = 'const a = 1\n  // Explain this line\n'
    const [comment] = findComments(code, 'ts')
    expect(comment).toEqual({ line: 1, start: 17, end: 34, text: 'Explain this line' })
    expect(code.slice(comment!.start, comment!.end)).toBe('Explain this line')
  })

  it('should not find comments in unsupported languages', () => {
    expect(resolveLanguage('diff')).toBeUndefined()
    expect(findComments('// Some words here', 'diff')).toEqual([])
    expect(resolveLanguage('TypeScript')).toBe('js')
  })

  it('should recognise prose', () => {
    expect(isProseComment('do something')).toBe(true)
    expect(isProseComment('Disable `@nuxt/image` module')).toBe(true)
    expect(isProseComment('vite: true,')).toBe(false)
    expect(isProseComment('~/plugins/vuelidate.js')).toBe(false)
  })
})

describe('applyCode', () => {
  it('should replace only the comment text', () => {
    const code = '/**\n * Fetch the data first.\n */\nconst a = 1 // the answer here\n'
    const { segments } = extractCode(code, 'ts')
    expect(segments.map(s => [s.kind, s.format, s.skeleton])).toEqual([['code-comment', 'plain', 'Fetch the data first.'], ['code-comment', 'plain', 'the answer here']])
    const { code: out, report } = applyCode(code, 'ts', new Map([[segments[0]!.hash, 'Récupérer les données.'], [segments[1]!.hash, 'la réponse']]))
    expect(out).toBe('/**\n * Récupérer les données.\n */\nconst a = 1 // la réponse\n')
    expect(report).toEqual({ applied: 2, missing: 0, rejected: [] })
  })

  it('should protect inline code and URLs in comments', () => {
    const code = '// Call `useFetch` here, see https://nuxt.com/docs for more'
    const [segment] = extractCode(code, 'ts').segments
    expect(segment!.skeleton).toBe('Call {0} here, see {1} for more')
    const { code: out } = applyCode(code, 'ts', new Map([[segment!.hash, 'Appeler {0} ici, voir {1}']]))
    expect(out).toBe('// Appeler `useFetch` ici, voir https://nuxt.com/docs')
  })

  it('should reject translations that would escape the comment', () => {
    const code = '/* Explain the thing here */\n<!-- -->'
    const [segment] = extractCode(code, 'ts').segments
    const translations = new Map([[segment!.hash, 'Expliquer */ alert(1) /*']])
    const { code: out, report } = applyCode(code, 'ts', translations)
    expect(out).toBe(code)
    expect(report.rejected[0]!.errors.map(e => e.code)).toContain('comment-terminator')
    expect(applyCode('// Explain the thing here', 'ts', new Map([[segment!.hash, 'line\nbreak']])).report.rejected).toHaveLength(1)
  })
})
