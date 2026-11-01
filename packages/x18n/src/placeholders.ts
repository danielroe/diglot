import type { Placeholder as DiglotPlaceholder, IssueCode } from '@diglot/core'
import type { Placeholder, PlaceholderSyntax } from '@x18n/core'
import { validate } from '@diglot/core'

const PLACEHOLDER = /(?<!\\)\{(\/?)(\d+)\}/g
const STRUCTURE: ReadonlySet<IssueCode> = new Set(['nesting', 'unclosed', 'not-paired'])

/** Placeholders of a skeleton. A paired placeholder yields `{n}` and `{/n}`, so a missing close counts as a mismatch. */
export function findPlaceholders(value: string): Placeholder[] {
  return [...value.matchAll(PLACEHOLDER)].map(match => ({
    syntax: 'diglot',
    text: match[0],
    name: `${match[1]}${match[2]}`,
    range: { start: match.index, end: match.index + match[0].length },
  }))
}

export function structureErrors(value: string): string[] {
  const found = findPlaceholders(value)
  const paired = new Set(found.filter(p => p.name.startsWith('/')).map(p => p.name.slice(1)))
  const placeholders: DiglotPlaceholder[] = [...new Set(found.map(p => p.name.replace('/', '')))].map(id => ({
    id: Number(id),
    type: paired.has(id) ? 'link' : 'other',
    source: '',
    ...(paired.has(id) ? { close: '' } : {}),
  }))
  return validate(value, { kind: 'paragraph', format: 'markdown', placeholders })
    .errors
    .filter(issue => STRUCTURE.has(issue.code) && (issue.code !== 'unclosed' || issue.message.includes('{')))
    .map(issue => issue.message)
}

/** The diglot skeleton grammar: `{n}` stands for a protected span, `{n}...{/n}` wraps link text. */
export const skeletonSyntax: PlaceholderSyntax = {
  id: 'diglot',
  example: '{0}text{/0}',
  find: findPlaceholders,
  validate: structureErrors,
}
