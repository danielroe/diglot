import type { LocaleStyle } from '@diglot/core'

const NARROW = '\u202F'
const SPACES = '[ \\u00A0\\u202F]'

function escape(chars: string): string {
  return [...chars].map(ch => ch.replace(/[\\\]^-]/g, '\\$&')).join('')
}

/**
 * Applies the typography rules of a locale style: a narrow no-break space before each
 * `spaceBefore` character that ends a word, and after each `spaceAfter` character.
 */
export function applyTypography(text: string, typography: LocaleStyle['typography']): string {
  let out = text
  if (typography?.spaceBefore) {
    const marks = escape(typography.spaceBefore)
    out = out.replace(new RegExp(`(?<=[^\\s\\\\${marks}])(?<!&shy|&nbsp)${SPACES}?([${marks}])(?=$|[\\s\\p{P}\\p{S}])`, 'gu'), `${NARROW}$1`)
  }
  if (typography?.spaceAfter) {
    const marks = escape(typography.spaceAfter)
    out = out.replace(new RegExp(`([${marks}])${SPACES}?(?=\\S)`, 'gu'), `$1${NARROW}`)
  }
  return out
}
