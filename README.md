# diglot

[![Github Actions][github-actions-src]][github-actions-href]
[![Codecov][codecov-src]][codecov-href]

> Segment-level, human-first translation for markdown documentation

Keeping markdown documents in-sync is tricky, and diglot exists to help solve these problems.

1. diglot splits markdown documents into segments + uniquely hashes them
2. translations are stored in git, with one record per locale and hash
3. identical text is translated only once
4. changes to URLs, components and HTML can skip re-translation

## Packages

| Package | Description |
| --- | --- |
| [`@diglot/core`](./packages/core) | Segment model, placeholder form and hashing, validation, apply helpers, segment diff, sentence diff, translation records, policy and glossary types. No parser dependencies. |
| [`@diglot/comark`](./packages/comark) | Extract and apply for [comark](https://github.com/comarkdown/comark) documents, plus `.navigation.yml` files. |
| [`@diglot/mdast`](./packages/mdast) | Extract and apply for markdown and MDX, parsed with remark (`remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-mdc` or `remark-mdx`) or [Sätteri](https://satteri.bruits.org). |
| [`@diglot/code`](./packages/code) | Comment extraction and apply for fenced code blocks. |
| [`@diglot/store`](./packages/store) | Git record store, source manifests, locale bundles, `sources.yml` and `diglot.config.ts` loading. |
| [`@diglot/mt`](./packages/mt) | Machine translation with the AI SDK: page-batched translation, minimal updates of existing translations, glossary and style rules, model-free QA. |
| [`@diglot/action`](./packages/action) | GitHub Action that extracts sources, machine-translates what changed and commits the records. |
| [`@diglot/cli`](./packages/cli) | The `diglot` command: `checkout`, `extract`, `diff`, `validate`, `build`, `status`. |
| [`@diglot/x18n`](./packages/x18n) | Experimental [x18n](https://github.com/x18n-dev/x18n) plugin: hashes as keys, records as messages, source documents as usages. |
| [`@diglot/astro`](./packages/astro) | [Astro](https://astro.build) integration and content loader that add translated Markdown and MDX pages for the locales of your `i18n` config, built from the records of a translations repository. |
| [`@diglot/starlight`](./packages/starlight) | [Starlight](https://starlight.astro.build) plugin and docs loader that set up `@diglot/astro` for a Starlight site, its locales and its components. |

## Quick start

In a translations repository:

```ts
// diglot.config.ts
import { defineConfig } from '@diglot/core'

export default defineConfig({
  locales: ['fr', 'ja'],
})
```

```yaml
# sources.yml
sources:
  - name: nuxt-main
    repo: nuxt/nuxt
    ref: main
    path: ../nuxt
    dir: docs
```

```bash
pnpm dlx @diglot/cli extract   # write .diglot/manifest/<source>.json
pnpm dlx @diglot/cli status    # coverage per locale and source
pnpm dlx @diglot/cli validate  # check every record
pnpm dlx @diglot/cli build     # write dist/<locale>.json
```

Records live at `<locale>/segments/<hh>/<hash>.json`.

## Development

- Clone this repository
- Install dependencies using `pnpm install`
- Run tests using `pnpm test`
- Run the corpus checks against shallow clones of `nuxt/nuxt` (branches `main`, `4.x`, `3.x` in `nuxt-main`, `nuxt-4.x`, `nuxt-3.x`) and `nuxt/fonts` under `$DIGLOT_CORPUS` (default `/tmp/repos`) with `pnpm corpus`

## License

Made with ❤️

Published under [MIT License](./LICENCE).

<!-- Badges -->

[github-actions-src]: https://img.shields.io/github/actions/workflow/status/danielroe/diglot/ci.yml?branch=main&style=flat-square
[github-actions-href]: https://github.com/danielroe/diglot/actions?query=workflow%3Aci
[codecov-src]: https://img.shields.io/codecov/c/gh/danielroe/diglot/main?style=flat-square
[codecov-href]: https://codecov.io/gh/danielroe/diglot
