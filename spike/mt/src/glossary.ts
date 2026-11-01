export type Locale = 'fr' | 'ja'

export type GlossaryDecision =
  | { decision: 'keep' }
  | { decision: 'translate', target: string, accept?: RegExp }
  | { decision: 'keep-gloss', gloss: string }

export interface GlossaryEntry {
  term: string
  match: RegExp
  note?: string
  locales: Record<Locale, GlossaryDecision>
}

const keep = { decision: 'keep' } as const
const tr = (target: string, accept?: RegExp): GlossaryDecision => ({ decision: 'translate', target, accept })
const gloss = (g: string): GlossaryDecision => ({ decision: 'keep-gloss', gloss: g })

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'Nuxt', match: /\bNuxt\b/, locales: { fr: keep, ja: keep } },
  { term: 'Nitro', match: /\bNitro\b/, locales: { fr: keep, ja: keep } },
  { term: 'Vue', match: /\bVue\b/, locales: { fr: keep, ja: keep } },
  { term: 'Nuxt DevTools', match: /\bDevTools\b/, locales: { fr: keep, ja: keep } },
  { term: 'useFetch', match: /\buseFetch\b/, locales: { fr: keep, ja: keep } },
  { term: 'useAsyncData', match: /\buseAsyncData\b/, locales: { fr: keep, ja: keep } },
  { term: 'SSR', match: /\bSSR\b/, locales: { fr: keep, ja: keep } },
  { term: 'composable', match: /\bcomposables?\b/i, note: 'Vue Composition API function', locales: { fr: keep, ja: tr('コンポーザブル') } },
  { term: 'layer', match: /\blayers?\b/i, note: 'Nuxt layers feature (extends)', locales: { fr: gloss('couche'), ja: tr('レイヤー') } },
  { term: 'plugin', match: /\bplugins?\b/i, locales: { fr: keep, ja: tr('プラグイン') } },
  { term: 'middleware', match: /\bmiddlewares?\b/i, locales: { fr: keep, ja: tr('ミドルウェア') } },
  { term: 'auto-import', match: /\bauto-?import(?:s|ed|ing)?\b|\bautomatically imports?\b/i, locales: { fr: tr('import automatique', /import\p{L}* automatique|automatiquement import|import\p{L}* automatiquement|auto-import/iu), ja: tr('自動インポート', /自動インポート|自動的にインポート/) } },
  { term: 'hydration', match: /\bhydrat(?:ion|es?|ed|ing)\b/i, locales: { fr: tr('hydratation', /hydrat/i), ja: tr('ハイドレーション', /ハイドレーション|ハイドレート/) } },
  { term: 'payload', match: /\bpayload\b/i, note: 'Nuxt payload (serialised server state)', locales: { fr: gloss('charge utile'), ja: tr('ペイロード') } },
  { term: 'server route', match: /\bserver routes?\b/i, locales: { fr: tr('route serveur', /routes? (?:de |du )?serveur/i), ja: tr('サーバールート') } },
  { term: 'runtime config', match: /\bruntime config\b/i, locales: { fr: keep, ja: tr('ランタイム設定') } },
  { term: 'data fetching', match: /\bdata[- ]fetching\b/i, locales: { fr: tr('récupération de données', /récupération (?:de|des) données/i), ja: tr('データ取得', /データ(?:の)?(?:取得|フェッチ)/) } },
  { term: 'component', match: /\bcomponents?\b/i, locales: { fr: tr('composant', /composant/i), ja: tr('コンポーネント') } },
  { term: 'directory', match: /\bdirector(?:y|ies)\b/i, locales: { fr: tr('répertoire', /répertoire|dossier/i), ja: tr('ディレクトリ') } },
]

function keepRegex (entry: GlossaryEntry): RegExp {
  return new RegExp(entry.match.source, entry.match.flags.replace('g', ''))
}

export interface GlossaryHit {
  term: string
  decision: GlossaryDecision['decision']
  ok: boolean
}

export function checkGlossary (source: string, target: string, locale: Locale, glossary = GLOSSARY): GlossaryHit[] {
  const hits: GlossaryHit[] = []
  for (const entry of glossary) {
    if (!entry.match.test(source)) { continue }
    const d = entry.locales[locale]
    let ok: boolean
    if (d.decision === 'translate') {
      ok = d.accept ? d.accept.test(target) : target.includes(d.target)
    }
    else {
      ok = keepRegex(entry).test(target) || target.toLowerCase().includes(entry.term.toLowerCase())
    }
    hits.push({ term: entry.term, decision: d.decision, ok })
  }
  return hits
}

export function glossaryPrompt (locale: Locale, glossary = GLOSSARY): string {
  const lines = glossary.map((e) => {
    const d = e.locales[locale]
    const note = e.note ? ` (${e.note})` : ''
    if (d.decision === 'keep') { return `- "${e.term}"${note}: keep in English, do not translate or transliterate` }
    if (d.decision === 'translate') { return `- "${e.term}"${note}: translate as "${d.target}"` }
    return `- "${e.term}"${note}: keep in English; on its first use in a page add the gloss in parentheses: "${e.term} (${d.gloss})"`
  })
  return lines.join('\n')
}
