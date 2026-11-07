# diglot Example: Angular

A small [Angular](https://angular.dev) app, written in English and translated into French and Turkish by [diglot](../../README.md). Its pages are Markdown files, and [`@diglot/angular`](../../packages/angular) applies the bundle of `translations`, a translations repository that lives inside the app, when a page loads. Every page is prerendered in all three locales.

> 🧑‍🚀 **Running it from this repository?** Install from the root of the diglot repository, so that the example uses the local diglot packages.

## 🚀 Project Structure

```text
/
├── public/
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── app.config.server.ts
│   │   ├── app.config.ts
│   │   ├── app.routes.server.ts
│   │   ├── app.routes.ts
│   │   ├── app.ts
│   │   ├── locales.ts
│   │   ├── markdown.ts
│   │   └── page.ts
│   ├── content/
│   │   └── docs/
│   │       ├── about.md
│   │       ├── guide.md
│   │       └── index.md
│   ├── index.html
│   ├── main.server.ts
│   ├── main.ts
│   └── styles.css
├── translations/
│   ├── fr/segments/
│   ├── tr/segments/
│   ├── diglot.config.ts
│   ├── sources.yml
│   └── x18n.config.ts
├── angular.json
└── package.json
```

`src/app/app.config.ts` sets up diglot with `provideDiglot()` and reads the locale from the `:locale` route parameter. `src/app/page.ts` reads its page with `diglotDocument()`, renders it with [marked](https://marked.js.org), and shows a notice when the report says that some text is still in English. `src/app/app.routes.server.ts` prerenders every page in every locale.

## 🧞 Commands

Run these from the example's directory:

| Command | Action |
| :--- | :--- |
| `pnpm start` | Builds the translations and starts the dev server at `localhost:4200` |
| `pnpm build` | Builds the translations and prerenders the app to `dist/` |
| `pnpm translations:extract` | Splits the English pages into segments |
| `pnpm translations:build` | Extracts the segments and builds the bundles in `translations/dist` |
| `pnpm translations:status` | Shows how much of French and Turkish is translated |
| `pnpm translations:ui` | Opens the x18n dashboard to review the translations |

## 🌍 What the translations show

`pnpm build` prerenders nine pages: `/en`, `/en/guide` and `/en/about`, and the same three under `/fr` and `/tr`.

The French and Turkish records live in `translations/fr/segments` and `translations/tr/segments`. They translate every segment except one paragraph of the about page, so that paragraph stays in English, and the page shows a notice that it is only partly translated. The notice comes from the `report` of `diglotDocument()`. The home page links to the guide with a relative link, `guide`, which `src/app/markdown.ts` points to the guide of the same language.

`pnpm translations:status` extracts the segments and prints the coverage. The untranslated segment is the paragraph of the about page:

```text
fr
  app: 16 segments, 163 words, 79.8% of words reviewed (edited 15, untranslated 1)
tr
  app: 16 segments, 163 words, 79.8% of words reviewed (edited 15, untranslated 1)
```

## 🔍 Review in the dashboard

`pnpm translations:ui` extracts the segments, exports the English pages for the usage view, and starts the x18n dashboard on a free port from `9999`. The terminal shows the address and an auth code to sign in. In the dashboard, every segment is a key with its French and Turkish translations.

When you approve a translation, its record becomes verified, and the approval is added to `translations/.x18n/reviews.yml`. When you edit a translation, the record changes too. The app reads the bundles in `translations/dist`, so run `pnpm translations:build` and reload the page to see the new text.

## 👀 Want to learn more?

Read the [Angular integration docs](https://diglot.sh/integrations/angular) for the options of `provideDiglot()` and `diglotDocument()`, and the [Review UI docs](https://diglot.sh/review-ui/overview) for what the x18n plugin adds.
