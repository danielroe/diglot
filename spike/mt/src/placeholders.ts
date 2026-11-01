export type TokenKind = 'code' | 'url' | 'mdc' | 'html' | 'mustache' | 'attrs'

export interface Token {
  id: number
  kind: TokenKind
  value: string
}

export interface Masked {
  masked: string
  tokens: Token[]
}

const RULES: Array<{ kind: TokenKind, re: RegExp, inner?: (m: RegExpExecArray) => [string, string, string] }> = [
  { kind: 'code', re: /(`+)(?:(?!\1)[\s\S])+?\1(?:\{[^}\n]*\})?/y },
  { kind: 'mustache', re: /\{\{[\s\S]*?\}\}/y },
  { kind: 'url', re: /\]\(((?:<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?)\)/y, inner: m => ['](', m[1]!, ')'] },
  { kind: 'mdc', re: /:[a-z][\w-]*(?:\[[^\]\n]*\])?\{[^}\n]*\}/y },
  { kind: 'html', re: /<\/?[A-Za-z][\w.-]*(?:\s[^<>]*?)?\/?>|<https?:[^>\s]+>/y },
  { kind: 'attrs', re: /\{[.#:a-z][^}\n]*\}/y },
]

export const PLACEHOLDER_RE = /\{(\d+)\}/g
export const PLACEHOLDER_LIKE_RE = /[{｛]\s*\d+\s*[}｝]|\[\s*\d+\s*\](?!\()|<\d+\s*\/?>|\$\d+\b/g

export function mask (text: string, options: { dedupe?: boolean } = {}): Masked {
  if (/\{\d+\}/.test(text.replace(/`[^`]*`/g, ''))) {
    throw new Error(`source already contains a placeholder-shaped literal: ${text}`)
  }
  const tokens: Token[] = []
  let out = ''
  let i = 0
  outer: while (i < text.length) {
    for (const rule of RULES) {
      if (rule.kind === 'mdc' && i > 0 && /[\w:]/.test(text[i - 1]!)) { continue }
      if (rule.kind === 'attrs' && !(i > 0 && /[\])*_`]/.test(text[i - 1]!))) { continue }
      rule.re.lastIndex = i
      const m = rule.re.exec(text)
      if (!m) { continue }
      const [pre, value, post] = rule.inner ? rule.inner(m) : ['', m[0], '']
      let token = options.dedupe ? tokens.find(t => t.kind === rule.kind && t.value === value) : undefined
      if (!token) {
        token = { id: tokens.length, kind: rule.kind, value }
        tokens.push(token)
      }
      out += `${pre}{${token.id}}${post}`
      i += m[0].length
      continue outer
    }
    out += text[i]
    i++
  }
  return { masked: out, tokens }
}

export function unmask (masked: string, tokens: Token[]): string {
  return masked.replace(PLACEHOLDER_RE, (all, n: string) => tokens[Number(n)]?.value ?? all)
}

export function maskWith (text: string, tokens: Token[]): string {
  const { masked, tokens: local } = mask(text)
  return masked.replace(PLACEHOLDER_RE, (_all, n: string) => {
    const t = local[Number(n)]!
    const match = tokens.find(x => x.kind === t.kind && x.value === t.value)
    return match ? `{${match.id}}` : t.value
  })
}
