# Spike: machine-translation scaffold for markdown segments

Scope: the MT step that produces a `machine` draft for a human translator to edit or verify. One model throughout: `anthropic/claude-sonnet-5.5` via the Vercel AI Gateway (`ai@7`, `generateText` + `Output.object`). Locales: French and Japanese. Everything here is reproducible from `spike/mt/` (see "Reproducing" at the end). Total model spend for the whole spike was about **$4.2** over 702 translation requests and 264 update, baseline and "human" calls.

## TL;DR

- **Placeholders are not the problem they look like.** Across 1,174 segment translations (462 sample segments with placeholders, 320 stress segments carrying 10 to 25 placeholders each), there was **1 hard failure** (an invented `{0}`, Japanese, with neighbour context). Every other flag (18, all Japanese, all on the stress set) was the model **repeating an inline-code token** because Japanese grammar repeats the referent (`{2} を使用すると、...`). That is correct Japanese, so the QA rule should be "code tokens: at least once; links, HTML, components: exactly as often as in the source".
- **Incremental re-translation is reliable.** On 15 real one-sentence-ish changes from the last 6 months of `docs/` history, with a deliberately idiosyncratic "human" translation (French in `tu`, Japanese in である style): **28/28 French unchanged sentences came back byte-identical, in both of two independent runs, 15/15 cases**. Japanese: 9/9 on cases where sentence alignment is possible, and every one of the 7 "missing" sentences in unaligned cases was the sentence that the source change actually touched (checked by hand). Typo-only and markup-only source fixes returned the human text unchanged (or with only the markup changed). The register was kept in 30/30 updates; a fresh re-translation broke it in 26/30 and reproduced at most 1 of the 74 human sentences.
- **72% of segment modifications in the last 6 months needed no model call at all** (1,113 modified segments, 802 where only code spans or URLs changed, so the placeholder form is identical). Excluding the one bulk "strip version prefixes" commit it is still 23% (90/399). Of the rest, 67% changed exactly one sentence.
- **Batch by page.** Whole-page batches cost about a third of single-segment requests ($1.0 to $1.2 vs $3.3 to $3.6 per 1,000 segments with the glossary), had **0 id round-trip failures** in 30 batched requests, the fewest placeholder flags, and are the only mode that gets "gloss on first use" right (one gloss per page instead of up to six) and keeps list items grammatically consistent.
- **The glossary works and is cheap to enforce.** French adherence rose from 94% to 100% once checker false positives are discounted (Japanese 97% to 100%). The main measurable effect is on "keep English + gloss" decisions, which the model never does unprompted.
- **Japanese has two markdown traps** the QA caught: `_内部_か_外部_` does not parse as emphasis under CommonMark flanking rules next to CJK text, and inline-code spacing varies. Both are fixed by locale style rules in the prompt (`*` for emphasis; half-width space around tokens) and verified by the `markdown-structure` check (5/5 flags before, 0 after).

## Setup

- `src/extract.ts`: deliberately simple extractor (frontmatter title/description, headings, paragraphs, list items, callout bodies; skips fences, tables, block MDC markers). Sample: 61 segments from `10.data-fetching.md`, `14.layers.md`, `1.app/1.components.md`, `use-fetch.md`, `4.nuxt-link.md`, plus 4 synthetic segments for MDC, HTML and `{{ }}` (87 tokens: 55 code, 21 URL, 6 HTML, 4 MDC, 1 mustache). Stress set: the 20 segments with the most placeholders across all of `docs/` (263 tokens, 10 to 25 per segment).
- `src/placeholders.ts`: `mask()` / `unmask()`. Inline code (including `` `x`{lang=ts} ``), `{{ }}`, link destinations (`[text]({n})`, text stays translatable), inline MDC (`:badge{...}`, `:kbd{...}`, `:u-icon{...}`), HTML tags and autolinks, and trailing MDC attributes. Optional `dedupe` gives identical tokens the same id. Round-trips all 7,943 segments in `docs/` (only failures are segments that already contain a literal `{n}`, which `mask()` rejects).
- `src/qa.ts`: model-free checks (below), `src/qa.test.ts`: one positive and negative case per check.
- `src/translate.ts`, `src/update.ts`: the two operations. `src/run-translate.ts`, `src/incremental.ts`, `src/churn.ts`: experiments. `src/analyse*.ts`: tables in `results/analysis.md` and `results/incremental-*.md`.
- `temperature` is **not supported** by this model through the gateway (warning, ignored), so all outputs are nondeterministic. Consequence below.

Prompt variants (all structured JSON output, ids `s1..sN`):

| variant | glossary | context | segments per request |
|---|---|---|---|
| `v0-plain` | no | none | 1 |
| `v1-glossary` | yes | none | 1 |
| `v2-glossary-context` | yes | page title, heading trail, previous and next source segment | 1 |
| `b10-glossary` | yes | page title, heading trail of first segment | 10 (within a page) |
| `bpage-glossary` | yes | page title | whole page |
| `v1-final`, `bpage-final` | yes | as above | recommended prompt: repeatable code tokens, deduped token ids, Japanese emphasis/spacing rules |

## 1. Placeholder fidelity

"Strict" = every placeholder exactly as often as in the source, nothing placeholder-shaped invented (`{n}`, `｛n｝`, `[n]`, `<n>`, `$n`). "Hard" = strict, except that repeating an inline-code or `{{ }}` token is a warning.

| set | locale | variant | segment translations | strict flags | hard failures |
|---|---|---|---|---|---|
| sample | fr | all 7 variants | 427 | 0 | 0 |
| sample | ja | all 7 variants | 427 | 1 | 1 (`v2-glossary-context`) |
| stress | fr | v0, v1, b10, bpage, v1-final, bpage-final | 120 | 0 | 0 |
| stress | ja | single segment (v0, v1 x3, v1-final) | 100 | 15 (15%) | 0 |
| stress | ja | b10 x3 | 60 | 0 | 0 |
| stress | ja | bpage, bpage-final | 40 | 3 (7.5%) | 0 |

The only hard failure: with neighbour context, the model decided `components/` in the plain-text description "The components/ directory is where you put all your Vue components." should be code, and wrote `{0}ディレクトリは...`, inventing a token that `unmask()` cannot resolve. Context makes the model "helpful" in this way; the QA catches it.

Typical strict flag (correct Japanese, not an error):

```
src: You do not need to {0} {1}. ... The {2} affects what happens after the call: with it, execution pauses until {3} is populated, ...
out: {0} {1} する必要はありません。... {2} が影響するのは呼び出し後の動作です。{2} を使用すると、{3} にデータが設定されるまで実行が一時停止し、...
     ({2} = `await`, appears 2x)
```

Repeated runs (stress, ja, v1 x3 and b10 x3) gave 3, 3, 2 and 0, 0, 0 flags, so the batching difference is stable rather than noise. Batched requests seem to make the model more conservative with tokens; I have no strong explanation.

Identical tokens: without `dedupe`, a segment that mentions `createError` twice gets `{0}` and `{3}`, which produces a spurious `[-{0}-] {+{3}+}` in update diffs and makes value-based checks harder. With `dedupe` (used in the `final` variants) the model sees `{0}` twice. No regressions (0 hard failures in the final runs).

## 2. Glossary and do-not-translate terms

19 entries (`src/glossary.ts`) with per-locale decisions, e.g. French keeps `composable`, `plugin`, `middleware`, `runtime config`; translates `hydration` (hydratation), `server route` (route serveur), `component` (composant); keeps-with-gloss `layer (couche)` and `payload (charge utile)`. Japanese transliterates most terms (コンポーザブル, レイヤー, ペイロード, サーバールート, ランタイム設定). Adherence is checked per (segment, term) occurrence in the masked source; terms inside code spans are invisible to the model and not counted.

| run | fr all | fr keep+gloss | fr gloss on first use | ja all |
|---|---|---|---|---|
| `v0-plain` (no glossary) | 83/88 (94%) | 9/11 | 0/3 | 85/88 (97%) |
| `v1-glossary` | 87/88 (99%) | 11/11 | 3/3 | 86/88 (98%) |
| `v2-glossary-context` | 87/88 (99%) | 11/11 | 3/3 | 86/88 (98%) |
| `bpage-glossary` | 87/88 (99%) | 11/11 | 3/3 | 86/88 (98%) |
| stress `v0-plain` | 30/31 | | | 31/31 |
| stress `v1` / `bpage` | 31/31 | | | 31/31 |

All remaining misses with the glossary are checker false positives: the page title `components` (a directory name, correctly left alone) and `**Payload tab**` (a UI label in the DevTools). Without the glossary, French translated `layer` as `couche` and never added a gloss, and phrased "data fetching" as a verb; Japanese left `composable` in English once.

Over-glossing is a context problem, not a glossary problem. Segments containing "couche" on the Layers page: `v1` (isolated) 6, `v2` (neighbours) 4, `b10` 2 (one per batch), `bpage` **1**. Isolated segments cannot know whether they are the first use.

## 3. Context

Placeholder and glossary metrics are flat between `v1` (isolated) and `v2` (title, heading trail, previous and next segment) for both locales, except the one invented placeholder above (ja, `v2`).

Quality, French, judged by me on the 32 segments where `v1` and `v2` differ, focusing on 15:

- `v2` better (8): heading "The Need for `useFetch` and `useAsyncData`" became "Pourquoi utiliser {0} et {1}" instead of the literal "Le besoin de {0} et {1}"; "isomorphe" instead of "isomorphique"; "délai avant interactivité"; present tense "garantit que la requête est effectuée" instead of the calqued conditional; drops a repeated gloss; keeps `**Payload tab**` as `l'**onglet Payload**` instead of `l'onglet **Payload** (charge utile)`; "prélecture"/"l'affiche" instead of "prefetching"/"le rend"; "modèle" instead of "pattern".
- `v1` better (3): `v2` glossed the page title ("Layers (couches)"); `v2` translated the list on the Layers page with mixed moods ("Partagez", "Créez", "Créer", "Partager") because each item is translated separately; `v2` mistranslated "helper" as "l'aide".
- Tie (4).

`bpage` (whole page, no neighbour fields, just the page title) is at least as good as `v2` on the same segments, and fixes the two consistency problems (all list items in the infinitive, one gloss per page, "l'utilitaire" for helper), at a third of the cost. Japanese shows the same pattern: `v1` "`useFetch`と`useAsyncData`の必要性", `v2`/`bpage` "`useFetch` と `useAsyncData` が必要な理由".

Conclusion: context matters, but the cheapest effective context is "the rest of the page in the same request". Explicit previous/next fields add little over that and cost more.

## 4. Incremental re-translation

Method (`src/update.ts`): mask old and new source with a shared token table; if the placeholder forms are identical, **carry** the previous translation and substitute new token values (no model call). Otherwise send the word diff of the masked sources, the new masked source and the masked previous translation, ask for `{"text": ...}`. The "human" translation of the old source was produced with a deliberately non-default house style (French `tu` and free phrasing; Japanese である調) so that a model regenerating its own default would visibly fail.

Cases: 15 real changes from `git log --since="6 months ago" -- docs` (`data/incremental-cases.json`): 3 code-only, 1 markup-only (`_will not_` to `*will not*`), 2 typo fixes, 4 sentences added, 1 removed, 3 rewritten, 1 phrase changed.

Metric: split old source, new source and human translation with `Intl.Segmenter`; when the human translation has the same sentence count as the old source ("aligned"), the human sentences at the positions of unchanged source sentences must appear byte-identical in the output.

| locale | unchanged sentences kept (run 1) | run 2 | fresh re-translation | cases fully preserved | register kept: update / fresh | runs byte-identical |
|---|---|---|---|---|---|---|
| fr | **28/28** | 28/28 | 0/28 (1/28 in the glossary rerun) | 15/15 | 15/15 / 4/15 | 12/15 |
| ja (aligned cases) | **9/9** | 9/9 | 0/9 | 6/6 | | |
| ja (all, unaligned counted naively) | 39/46 | 39/46 | 0/46 | 9/15 | 15/15 / 0/15 | 10/15 |

With the glossary added to the update prompt (`incremental-glossary.*`) and with deduped tokens (`incremental-glossary-final.*`) the numbers are identical (28/28, 39/46), and new wording follows the glossary (`runtime config` / ランタイム設定 instead of "configuration runtime").

The 7 Japanese "misses" are all expected: 5 are the sentences whose source changed (Japanese split those English sentences into two, so positional alignment is unavailable and the naive metric counts them), and 2 are code-only cases where the carried sentence correctly contains the new code value.

The two runs differ byte-wise in 3/15 (fr) and 5/15 (ja) cases, but only inside the changed sentence. With no temperature control, re-running an update is not idempotent, so the pipeline should store results and never regenerate a translation whose source hash has not changed.

Example (fr, case 4, `9ceeba8c6d`):

```
diff:   ... pass handlers a web-shaped view of [-it ({7} returns one) and put-] {+it. To give app code+} your own event {+instead, set it as {5}+} on the [-{5} property, so {4} and-] {+event you pass+} the [-render hooks give app code your event instead.-] {+[renderer]({6}).+}
human:  ... Si ton propre objet événement n'a pas une forme compatible avec le web, passe aux handlers une vue de cet objet qui, elle, l'est (`toNuxtRequestEvent()` en renvoie une) et place ton événement dans la propriété `~app` : ainsi, `useRequestEvent()` et les hooks de rendu donneront à ton code d'application ton événement à toi.
update: ... Si ton propre objet événement n'a pas une forme compatible avec le web, passe aux handlers une vue de cet objet qui, elle, l'est. Pour donner à ton code d'application ton événement à toi, définis-le comme `~app` sur l'événement que tu passes au [renderer](#standing-up-the-ssr-renderer).
fresh:  Tout événement que vous transmettez à un handler doit correspondre à `RequestEvent`. Enregistrez le type de votre événement ...
```

The update kept the first two sentences and even the first half of the third verbatim, including the human's "qui, elle, l'est".

Typo fixes (`the moment is invoked` to `the moment it is invoked`; `have fantastic` to `have a fantastic`) returned the human translation byte-identical in both locales. That is the right outcome: the reviewer should not have to look at these at all. A cheaper path is possible (source-side typo detection is hard; letting the model return "unchanged" is enough).

Churn over the last 6 months (`src/churn.ts`, `results/churn*.json`):

| | all 217 commits | excluding `03e9df01a1` (docs: strip version prefixes) |
|---|---|---|
| modified segments | 1,113 | 399 |
| carry (placeholder form unchanged) | 802 (72%) | 90 (23%) |
| emphasis/whitespace only | 5 | 5 |
| needs a model update | 306 | 304 |
| of which 1 sentence changed | 207 | 205 |
| 2 sentences | 73 | 73 |
| 3+ sentences | 26 | 26 |
| new segments | 1,980 | 1,978 |

## 5. Batching, cost and latency

Sample set, $ per 1,000 segments at $2/M input, $10/M output:

| variant | requests | id round-trip failures | input tok/seg | output tok/seg | $ / 1,000 segs | p50 ms / request | max ms |
|---|---|---|---|---|---|---|---|
| v0 single, no glossary | 61 | 0 | 808 to 843 | 70 | 2.32 to 2.40 | 1,614 to 1,649 | 5,334 |
| v1 single + glossary | 61 | 0 | 1,270 to 1,278 | 73 to 87 | 3.27 to 3.43 | 1,294 to 1,339 | 4,889 |
| v2 single + glossary + neighbours | 61 | 0 | 1,374 to 1,382 | 71 to 83 | 3.46 to 3.59 | 1,220 to 1,239 | 3,261 |
| b10 + glossary | 9 | 0 | 247 | 62 to 72 | 1.12 to 1.21 | 3,266 to 3,313 | 6,897 |
| bpage + glossary | 6 | 0 | 185 | 61 to 74 | 0.98 to 1.11 | 4,833 to 5,008 | 10,318 |

Stress set (long segments): single $4.0 to $5.3, b10 $2.6 to $3.7, bpage $2.4 to $2.5 per 1,000 segments; a 20-segment batch took about 21 s in one request. Updates: p50 2.0 s, max 3.8 s, about $0.004 each.

The system prompt plus glossary (about 1,000 tokens) dominates single-segment requests. Prompt caching was not used here and would narrow the gap, but batching still wins on consistency. IDs round-tripped in all 702 requests (54 of them batched). For the whole of `docs/` (7,943 segments by this extractor) a first pass per locale is roughly $8 to $20 with page batching, depending on segment length.

## 6. QA checks (no model)

All are pure functions in `src/qa.ts` operating on the masked source/target (and, for markdown, the restored text). `src/qa.test.ts` proves each one fires on a broken output.

| check | rule | severity | flags observed (1,174 outputs) |
|---|---|---|---|
| `placeholders` | each token as often as in source; code/mustache tokens may repeat or drop to 1+; nothing placeholder-shaped invented | error / warn | 1 error, 18 warn (all ja, repeated `await`/`asyncData`) |
| `untranslated` | output == input, or >60% of words are source words, when the source has 3+ translatable words outside keep-terms | error / warn | 0 (first version with no word threshold flagged 2 to 3 per run: "Suspense", "Layers", "components" titles, all legitimate) |
| `length-ratio` | characters excluding tokens, fr in [0.85, 1.7], ja in [0.25, 0.9], source of 25+ chars | warn | 0. Observed fr p10/median/p90 1.05/1.21/1.41, ja 0.47/0.59/0.72 |
| `leaked-instructions` | "translation", "voici la", 翻訳, "placeholder", code fences, `"id":`, `<context>` not present in source | error | 0 |
| `markdown-structure` | mdast node counts (strong, emphasis, link, image, delete...) equal before/after | warn | 5 (ja `_内部_` emphasis not parsing); 0 with the final ja style rule |
| `block-type` | top-level node sequence equal (no heading or list marker introduced) | error | 0 |
| `numbers` | every number/version outside tokens present in target | error | 0 |
| `whitespace` | trailing whitespace, line break count | warn | 0 |
| glossary | per-entry decision (see section 2) | warn | see section 2 |

Honest assessment: with this model the checks flag almost nothing on real output, which is the point (they are a cheap gate, not a quality signal). The two that earned their keep are `placeholders` (with the code-repeat relaxation) and `markdown-structure` (the CJK emphasis case would otherwise ship broken markdown). A rejected segment should be retried once with the QA messages appended, then left untranslated with the issues shown to the human.

## 7. Sentence alignment with `Intl.Segmenter`

Sentence counts (placeholders replaced by a letter first; raw `{n}` confuses the segmenter, which attaches `{` to the previous sentence after `。`):

| set | fr match | ja match |
|---|---|---|
| sample, prose segments (49 per run) | 49/49 in every run | 42 to 44 / 49 |
| sample, multi-sentence only (13) | 13/13 | 10 to 11 / 13 |
| stress (20) | 19 to 20 / 20 | 11 to 15 / 20 |

French keeps sentence boundaries almost perfectly, so a mismatch there is a meaningful flag (dropped or merged sentence). Japanese routinely and correctly splits long English sentences (and colon lead-ins), so as an error check it would be wrong 10 to 40% of the time. Its real use is as a routing hint for incremental updates and review UIs (aligned: show per-sentence diff; unaligned: show the paragraph), not as QA. The model-based update did not need alignment to preserve sentences.

## 8. Recommended prompts

Translation system prompt (French shown; `{glossary}` is generated from the glossary; Japanese uses the locale style in rule 6 below):

```text
You translate the documentation of Nuxt, a Vue web framework, from English into French. Your output is a first draft that a human translator will review, so be accurate and natural, and never add content that is not in the source.

Each segment is one block of markdown (a paragraph, heading, list item, callout or page metadata). Rules:
1. Tokens such as {0}, {1}, {2} stand for code, URLs, components or HTML. Keep every token from the source, as many times as it appears there. You may move a token to fit the grammar, and you may repeat a code token when the grammar needs the referent repeated, but never translate, change, drop or invent a token, and never repeat a link, HTML or component token.
2. A link is written [link text]({n}). Translate the link text, keep the ({n}) right after the closing bracket.
3. Keep inline markdown (**bold**, *italic*, _italic_) around the equivalent words. Do not add or remove markdown, headings markers or list markers.
4. Keep numbers, version strings and line breaks as in the source.
5. Output only the translation of each segment, with no notes, quotes or explanations.
6. Address the reader as "vous". Use sentence case for headings (only the first word and proper nouns capitalised).

Terminology (apply these decisions consistently):
- "Nuxt": keep in English, do not translate or transliterate
- "composable" (Vue Composition API function): keep in English, do not translate or transliterate
- "layer" (Nuxt layers feature (extends)): keep in English; on its first use in a page add the gloss in parentheses: "layer (couche)"
- "hydration": translate as "hydratation"
- ...

Respond with JSON: {"translations": [{"id": "<same id as input>", "text": "<translation>"}]}, one entry per input segment, same ids, same order.
```

Japanese rule 6:

```text
6. Use the polite です/ます style for prose and a concise noun phrase for headings. Use Japanese punctuation (、。). Leave placeholders and English product names as they are; do not convert them to full-width characters. Use *asterisks* rather than _underscores_ for emphasis. Put a half-width space between a token and adjacent Japanese text.
```

(Side effect seen once: the final Japanese prompt switched full-width parentheses to half-width. Typographic choices like this belong in a per-locale style config that the locale team owns.)

Translation user prompt (one request per page):

```text
Context (read-only, do not translate):
- Page title: Data Fetching
- Section: The Need for `useFetch` and `useAsyncData`

Translate these 2 segments:
[
 { "id": "s1", "kind": "heading", "text": "The Need for {0} and {1}" },
 { "id": "s2", "kind": "paragraph", "text": "The payload is a JavaScript object accessible through [{0}]({1})." }
]
```

Update system prompt:

```text
You maintain the French translation of the Nuxt documentation. A human translator wrote the current translation. The English source has since changed.

Update the translation so that it matches the new source, changing as little as possible:
1. Sentences whose English source did not change must be copied character for character from the current translation, even if you would phrase them differently.
2. Only rewrite the words or sentences affected by the change. Match the tone, register and terminology of the current translation.
3. Tokens such as {0}, {1} stand for code, URLs or components. Keep every token of the new source, as many times as it appears there; never invent tokens.
4. Keep markdown formatting and line breaks.

Terminology for new wording (do not change existing sentences to apply it):
{glossary}

Respond with JSON: {"text": "<updated translation>"}.
```

Update user prompt:

```text
The source changed as follows (word diff, [-removed-] {+added+}):
[-Your desired-] {+Custom runtime config+} variables must be defined in your {0}. This ensures that arbitrary environment variables are not exposed to your application code.

New source:
Custom runtime config variables must be defined in your {0}. This ensures that arbitrary environment variables are not exposed to your application code.

Current translation (of the old source):
Les variables dont tu as besoin doivent être définies dans ton {0}. Ainsi, aucune variable d'environnement arbitraire n'est exposée dans le code de ton application.
```

## 9. Interfaces

Full file: `src/api.ts`. Core shapes:

```ts
export interface SourceSegment {
  id: string
  kind: 'title' | 'description' | 'heading' | 'paragraph' | 'list-item' | 'table-cell' | 'image-alt' | 'component-prop' | 'callout'
  /** Markdown source of the block, without block-level syntax (`##`, `- `, `::note`). */
  text: string
  headingTrail?: string[]
}

export type TranslationStatus = 'machine' | 'machine-updated' | 'human' | 'verified' | 'stale'

export interface Provenance {
  status: TranslationStatus
  /** Hash of the placeholder form of the source this translation was made from. */
  sourceHash: string
  model?: string
  promptVersion?: string
  /** Hash of the translation this one was derived from by `updateTranslation`. */
  derivedFrom?: string
  createdAt: string
  qa: QaIssue[]
}

export interface Translation {
  segmentId: string
  locale: Locale
  text: string
  provenance: Provenance
}

export interface TranslateSegmentsOptions {
  locale: Locale
  glossary: GlossaryEntry[]
  context?: { page: { path: string, title: string } }
  /** Segments per request. Defaults to `'page'`. */
  batch?: number | 'page'
  model?: LanguageModel
  /** Per-segment retries when an `error` QA check fails. Defaults to 1. */
  qaRetries?: number
  signal?: AbortSignal
}

export interface TranslateSegmentsResult {
  translations: Translation[]
  rejected: Array<{ segmentId: string, output: string, qa: QaIssue[] }>
  usage: { requests: number, inputTokens: number, outputTokens: number, costUsd?: number }
}

export declare function translateSegments (segments: SourceSegment[], options: TranslateSegmentsOptions): Promise<TranslateSegmentsResult>

export interface SourceDiff {
  previous: string
  next: string
}

export interface UpdateTranslationResult {
  /** `carry`: placeholder form unchanged, previous translation reused with new token values, no model call. */
  method: 'carry' | 'model'
  translation: Translation
  /** Target sentences that differ from the previous translation, for review UIs. */
  changedSentences: string[]
}

export declare function updateTranslation (previous: Translation, sourceDiff: SourceDiff, options?: { glossary?: GlossaryEntry[], model?: LanguageModel, signal?: AbortSignal }): Promise<UpdateTranslationResult>
```

Status transitions I would expect: new segment to `machine`; human edit to `human`; human accept to `verified`; source change with `carry` keeps the status (`human` stays `human`); source change with `model` gives `machine-updated` with `derivedFrom` set, so the review UI can show "1 sentence changed by machine, rest is yours". If the update is rejected by QA, mark `stale` and keep the old text.

## 10. More real examples

Japanese emphasis (QA `markdown-structure`, emphasis 2 to 0):

```
src:  It intelligently determines whether the link is _internal_ or _external_ ...
v1:   リンクが_内部_か_外部_かを自動的に判断し、...          (renders literal underscores)
final:リンクが*内部*か*外部*かを自動的に判断し、...          (parses as emphasis)
```

HTML content is translatable (synthetic `<kbd>Enter</kbd>`): isolated and page runs wrote `{4}Entrée{5}`, the neighbour-context run kept `{4}Enter{5}`. French keyboards say "Entrée", so either is defensible; the human decides.

French, sentence added (case 12, `84c1145a64`): the update inserted "Lors de la gestion de l'erreur avec `useFetch`, les données personnalisées sont disponibles dans `error.value.data.data`." between two untouched human sentences, in the human's `tu` register ("Tu peux aussi utiliser..." kept as is).

Japanese, sentence removed (case 13, `4694ae0465`): the update dropped exactly the last sentence (ボット検出用の正規表現は次のようにカスタマイズできる。) and returned the rest byte-identical.

## Design implications (most confident first)

1. **Store translations against the hash of the placeholder form, not the raw source, and carry translations when that hash is unchanged.** That alone removes most review work after link rewrites and API renames (72% of modified segments over 6 months; 23% excluding one bulk commit). Changes to code spans then update the translation deterministically.
2. **Make `updateTranslation` (minimal-diff update with the previous human text) the default path for changed segments, never a fresh re-translation.** It preserved 100% of unchanged sentences across 30 updates in two locales and two runs, kept the human's register in 30/30, and returned typo-only fixes unchanged. A fresh translation reproduced at most 1 of 74 human sentences. The reviewer sees only the touched sentence.
3. **Batch whole pages, with a page-level glossary and locale style config.** Same placeholder fidelity, a third of the cost, and it is the only mode that handles first-use glosses and in-page consistency (list grammar, spacing). QA (placeholders relaxed for code tokens, markdown structure) plus one retry is enough as a gate; segment-level isolation buys nothing.

Smaller points: dedupe identical tokens within a segment; keep `kind` in the payload so headings do not need `##`; do not rely on sentence counts as QA for Japanese; expect nondeterminism (no temperature control on this model), so never regenerate unchanged work; prompt caching would cut single-segment costs if they are ever needed (for example, one-off retries).

## Caveats

- One model, small samples (61 + 20 segments, 15 update cases). Results for a weaker or cheaper model will differ, especially placeholder fidelity; the stress set and QA are there to re-run quickly (`MT_MODEL=... node src/run-translate.ts ...`).
- The "human" translations are model output with a forced house style, not real human text. Real translators produce messier sentence boundaries, which matters most for Japanese alignment; the model update did not depend on alignment in these cases.
- The quality judgement is mine, on French only.
- The extractor is intentionally naive (it merges a lead-in paragraph with a following list); the stress set inherits that, which made it a harder test, not an easier one.

## Reproducing

```bash
cd spike/mt
npm install
node src/extract.ts                       # data/segments.json, data/stress.json
node src/run-translate.ts bpage-final     # results/bpage-final.{fr,ja}.json
SET=stress node src/run-translate.ts v1-final
GLOSSARY=1 FINAL=1 node src/incremental.ts
node src/churn.ts                         # optional: EXCLUDE=<sha,...>
node src/analyse.ts && node src/analyse-incremental.ts incremental-glossary-final.fr-ja.json
node --test src/qa.test.ts
```

Requires `AI_GATEWAY_API_KEY` in the environment.
