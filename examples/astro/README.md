# diglot Example: Astro

A small [Astro](https://astro.build) site, written in English and translated into German and Japanese by [diglot](../../README.md). Its pages are Markdown and MDX files in a content collection, and [`@diglot/astro`](../../packages/astro) builds their translations from the records in `translations`, a translations repository that lives inside the site. You can also review those translations in the [x18n](https://github.com/x18n-dev/x18n) dashboard.

> 🧑‍🚀 **Running it from this repository?** Install from the root of the diglot repository, so that the example uses the local diglot packages.

## 🚀 Project Structure

Inside the example, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   └── Card.astro
│   ├── content/
│   │   └── docs/
│   │       ├── about.md
│   │       ├── components.mdx
│   │       ├── guide.md
│   │       ├── index.md
│   │       └── de/
│   │           └── about.md
│   ├── layouts/
│   │   └── Layout.astro
│   ├── pages/
│   │   └── [...slug].astro
│   ├── content.config.ts
│   └── i18n.ts
├── translations/
│   ├── de/segments/
│   ├── ja/segments/
│   ├── diglot.config.ts
│   ├── sources.yml
│   └── x18n.config.ts
├── astro.config.mjs
└── package.json
```

The English pages in `src/content/docs/` are the source. `astro.config.mjs` adds the `mdx()` and `diglot()` integrations and lists the locales in its `i18n` option. `src/content.config.ts` loads the pages with `diglotLoader()`, which adds the German and Japanese entries, and `src/pages/[...slug].astro` turns every entry into a page. `src/i18n.ts` works out the navigation and the language menu, and `src/layouts/Layout.astro` renders them in a dark theme.

`translations/` is a regular diglot translations repository. `diglot.config.ts` lists the locales `de` and `ja` and sets `parser: 'satteri'`, `sources.yml` points at the English pages, and the records live under `de/segments/` and `ja/segments/`. `x18n.config.ts` adds the diglot plugin for the dashboard.

## 🧞 Commands

All commands are run from the root of the example, from a terminal:

| Command                     | Action                                                     |
| :-------------------------- | :--------------------------------------------------------- |
| `pnpm install`              | Installs dependencies                                      |
| `pnpm dev`                  | Starts local dev server at `localhost:4321`                |
| `pnpm build`                | Builds the site in every language to `./dist/`             |
| `pnpm preview`              | Previews your build locally, before deploying              |
| `pnpm astro ...`            | Runs CLI commands like `astro add`, `astro check`          |
| `pnpm translations:extract` | Splits the English pages into segments                     |
| `pnpm translations:status`  | Shows how much of German and Japanese is translated        |
| `pnpm translations:ui`      | Opens the x18n dashboard to review the translations        |

## 🌍 What the translations show

`pnpm build` writes eleven pages: the four English pages at `/`, `/guide/`, `/components/` and `/about/`, their German versions under `/de/`, and three Japanese pages under `/ja/`.

German has a record for every segment of the home page, the guide and the components page. The about page is translated by hand. Because `src/content/docs/de/about.md` already exists in the collection, the loader keeps it and adds no translation of its own.

The Japanese records are machine translations. The last section of the Japanese guide has no records, so its text stays in English while the rest of the page is Japanese. The about page has no Japanese records at all, so there is no `/ja/about/`. When you open the about page, the language menu only offers English and German.

The components page is MDX. It imports a `Card` component and uses an expression, and the translated pages render both, with the card titles translated, because the default policy lists the `title` of a card as prose. The home page links to the guide with a relative link, `guide/`, so the link leads to the guide of the same language. `trailingSlash: 'always'` in the Astro config keeps every page URL ending in `/`, which that relative link relies on. URLs are protected from translation, which is why the example avoids absolute links between its pages.

`pnpm translations:status` extracts the segments and prints the coverage. The three untranslated German segments are those of the about page, which the site translates by hand:

```text
de
  site: 23 segments, 247 words, 83.4% of words reviewed (edited 20, untranslated 3)
ja
  site: 23 segments, 247 words, 0.0% of words reviewed (machine 18, untranslated 5)
```

## 🔍 Review in the dashboard

`pnpm translations:ui` extracts the segments, exports the English pages for the usage view, and starts the x18n dashboard on a free port from `9999`. The terminal shows the address and an auth code to sign in. In the dashboard, every segment is a key, and the 18 Japanese machine translations are waiting for review.

When you approve a translation, its record in `translations/ja/segments/` becomes verified, and the approval is added to `translations/.x18n/reviews.yml`. When you edit a translation, the record changes too, and while `pnpm dev` runs, the page shows the new text without a restart.

## 👀 Want to learn more?

Read the [Astro integration docs](https://diglot.sh/integrations/astro) for the options of the integration and the loader, and the [Review UI docs](https://diglot.sh/review-ui/overview) for what the x18n plugin adds.
