# Nuxt translations

A starting point for `nuxt/translations`: the Nuxt docs (`nuxt/nuxt` on `main`, `4.x` and `3.x`), the `nuxt/cli` docs and the `nuxt/fonts` docs, translated into French by [diglot](https://github.com/danielroe/diglot). Copy this directory into an empty repository to bootstrap it.

| File | Purpose |
| --- | --- |
| `diglot.config.ts` | Locales and machine translation settings |
| `sources.yml` | Repositories, refs and directories that feed the corpus |
| `glossary.yml` | Terminology shared by every locale, in [x18n](https://github.com/x18n-dev/x18n)'s `glossary` shape |
| `fr/glossary.yml` | French terminology that needs diglot-only fields (keep with a gloss, accepted variants) |
| `fr/style.yml` | French style rules and typography |
| `fr/locale.yml` | French machine translation switch, and the review metrics behind it once a governance job maintains them |
| `.github/workflows/translate.yml` | Runs the diglot Action on a source push, on demand and daily, and pushes its commit |

## Setup

1. Add an `AI_GATEWAY_API_KEY` secret (a [Vercel AI Gateway](https://vercel.com/ai-gateway) key).
2. Run the `translate` workflow once by hand. The first run translates every segment of every source; pass `limit` to spread it over several runs.
3. In each source repository, send a `repository_dispatch` of type `source-push` after a push that touches the docs, with `client_payload.sources` naming the sources to refresh. The daily schedule catches anything missed.

## French style

- Address the reader as `vous`; instructions in the imperative.
- Sentence case in headings, titles and labels.
- Code identifiers, file names, package names and configuration keys stay in English.
- Guillemets (`« »`) for quoted prose.
- A narrow no-break space (U+202F) before `;`, `:`, `!`, `?` and `»`, and after `«`. Machine output gets it from `typography` in `fr/style.yml` after translation, so the model does not have to produce the character.

## Switching machine translation off

Set `mt.enabled` to `false` in `fr/locale.yml`. The Action then writes no new French records, while existing ones stay in the bundle.
