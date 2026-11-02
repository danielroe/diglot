# @diglot/mt

Machine translation for [diglot](../../README.md) segments: page-batched translation of new segments, minimal updates of existing translations when their source changes, glossary and style rules in the prompt, and model-free QA on every output. Built on the [AI SDK](https://ai-sdk.dev), so any `LanguageModel` works.

```bash
pnpm add @diglot/mt @diglot/core
```

## Models

Pass a `LanguageModel` from any AI SDK provider as `model`, or a model id string for the [Vercel AI Gateway](https://vercel.com/ai-gateway). Without `model`, the id is read from `DIGLOT_MT_MODEL`. The gateway reads its key from `AI_GATEWAY_API_KEY`.

```ts
import { gatewayModel } from '@diglot/mt'

const model = gatewayModel('anthropic/claude-sonnet-5.5', { apiKey })
```

## Translating segments

```ts
import { translateSegments } from '@diglot/mt'

const { translations, rejected, usage } = await translateSegments(segments, {
  locale: 'fr',
  model,
  glossary, // loadGlossary(root, 'fr', { shared: config.glossary })
  style, // loadStyle(root, 'fr')
  subject: 'the documentation of Nuxt, a Vue web framework',
  context: file => ({ title: titles.get(file) }),
  batch: 'page',
  qaRetries: 1,
})

for (const t of translations)
  createRecord({ segment: byHash.get(t.hash)!, text: t.text, origin: 'mt', derived: t.derived, mt: t.mt })
```

- Segments are grouped by `context.file` and sent one page per request (`batch: 'page'`, at most `maxBatch` segments, default 40), or `batch: n` segments per request. Requests carry ids and the response is matched by id; missing ids count as failed segments.
- Identical segments (same hash) are translated once. Segments with no letters outside placeholders are skipped.
- Repeated atomic placeholders with the same markdown (`{0}` and `{2}` both `` `useFetch` ``) are shown to the model as one id and restored in order.
- Glossary entries are included only when their term occurs in the request.
- Each output is checked (see [QA](#qa)). Segments with an error-level issue are sent again once with the problems listed (`qaRetries`), then returned in `rejected` with their issues and last output.
- `translations[].mt` is `{ model, promptVersion, candidate }`, ready for a record.

## Updating a translation

```ts
import { updateTranslation } from '@diglot/mt'

const result = await updateTranslation(previousRecord, { previousSource: previousRecord.source, nextSource: segment }, { locale: 'fr', model, glossary, style })

if (result.status === 'ok')
  result.derived // 'carry' | 'update'
```

The placeholders of the previous source are aligned with the new source (words and placeholder types and markdown), and the previous translation is renumbered to match. When the two skeletons are identical (for example when only the context salt changed), the previous translation is returned as `derived: 'carry'` without a model call. Otherwise, including edits that only change case or punctuation, the model receives the word diff, the new source and the previous translation, with instructions to copy unchanged sentences character for character; the result is `derived: 'update'` with `changedSentences`, the sentences of the new text that are not in the previous one. `previousSource` can be a skeleton string or an object with `placeholders` for better alignment.

## Glossary

`glossary` is a `Glossary` from `@diglot/core`: a list of terms, each with a decision.

| Decision | Prompt | QA (warning) |
| --- | --- | --- |
| `keep` | Keep the term in English | The term (or its plural) is in the output |
| `translate` with `target` | Translate as `target` | `target` or one of the `accept` patterns is in the output |
| `translate` without `target` | Translate according to `note` | None |
| `keep-gloss` | Keep the term; on its first use in a page add `term (gloss)` | The term is in the output |

A term matches source text as a whole word, case-insensitively, or by `match` (a regular expression source); `caseSensitive: true` makes either case-sensitive. `note` is shown to the model.

### Sharing a glossary with x18n

[x18n](https://github.com/x18n-dev/x18n) keeps UI-string terminology in its `glossary` config option. `@diglot/store` reads the same entries, so a project can keep one terminology file for its UI strings and its docs. Point `glossary` in `diglot.config.ts` at a YAML or JSON file holding the list (or at an `x18n.config.yml`, whose `glossary` key is read):

```yaml
# glossary.yml
- term: Nuxt
  doNotTranslate: true
- term: composable
  note: a Vue Composition API function
  translations:
    fr: composable
    ja: コンポーザブル
- term: hydration
  translations:
    fr: hydratation
```

| x18n | diglot |
| --- | --- |
| `doNotTranslate: true` | `keep` |
| `translations[locale]` equal to the term | `keep` for that locale |
| `translations[locale]` | `translate` with `target` |
| no translation for the locale | `translate` without `target` |
| `note` | `note` |

Locale codes match exactly, then with `_` and `-` treated alike and case ignored (`pt_BR` serves `pt-BR`). x18n matches terms case-insensitively as whole words, which is diglot's default too.

x18n validates config entries strictly, so diglot-only fields stay out of the shared file. Put them in `<locale>/glossary.yml` in diglot's shape; an entry there replaces the shared entry with the same term:

```yaml
# fr/glossary.yml
terms:
  - term: layer
    match: \blayers?\b
    decision: keep-gloss
    gloss: couche
  - term: hydration
    match: \bhydrat(?:ion|es?|ed|ing)\b
    decision: translate
    target: hydratation
    accept: [hydrat]
```

## Style

`style` is a `LocaleStyle`, as stored in `<locale>/style.yml`:

```yaml
rules:
  - Address the reader as "vous".
  - Use sentence case in headings.
typography:
  spaceBefore: ';:!?»'
  spaceAfter: «
lengthRatio: [0.85, 1.7]
```

`rules` (and `style` from `glossary.yml`) are added to the prompts. `typography` is applied to machine output after translation: a narrow no-break space (U+202F) before each `spaceBefore` character that ends a word and after each `spaceAfter` character. In updates it applies only to changed sentences. `lengthRatio` overrides the default length band of the `length-ratio` check.

## QA

`runQa(translation, segment, { locale, glossary, style })` runs without a model:

| Check | Severity | Rule |
| --- | --- | --- |
| `grammar` | error | `validate` from `@diglot/core`: no markup outside the translation grammar, plain segments stay plain |
| `placeholders` | error, warning | Every placeholder present and paired; repeated code placeholders are a warning; no placeholder-like text (`｛1｝`, `[1]`, `<1>`, `$1`) that the source does not have |
| `untranslated` | error, warning | Output identical to a source of three or more translatable words; mostly source words |
| `length-ratio` | warning | Length outside the band for the locale (French 0.85 to 1.7, Japanese 0.25 to 0.9, ...) |
| `leaked-instructions` | error | Words such as "translation", "placeholder", "voici la", code fences or JSON keys that the source does not have |
| `structure` | error, warning | Heading markers in a heading; changed line count |
| `numbers` | error, warning | Version strings and multi-digit numbers kept (error); single digits (warning) |
| `emphasis` | error, warning | Emphasis markers that cannot open or close under CommonMark flanking rules, such as `_` inside a word or `**` between punctuation and CJK text; a warning when the source has such markers too |
| `glossary` | warning | See [Glossary](#glossary) |

## Usage and cost

Every result has `usage: { requests, inputTokens, outputTokens, costUsd? }`. `costUsd` is the cost reported by the provider (the AI Gateway reports one per request), or computed from `pricing: { input, output }` in USD per million tokens. `addUsage` sums usages.
