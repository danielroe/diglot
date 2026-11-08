# diglot Example: Angular

A small [Angular](https://angular.dev) app, written in English and translated into French and Turkish by [diglot](../../README.md). Its pages are Markdown files, and the code in `src/app` applies the bundle of `translations`, a translations repository that lives inside the app, when a page loads. Every page is prerendered in all three locales.

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
│   │   ├── app.html
│   │   ├── app.routes.server.ts
│   │   ├── app.routes.ts
│   │   ├── app.ts
│   │   ├── diglot-document.ts
│   │   ├── diglot-store.ts
│   │   ├── language.ts
│   │   ├── locales.ts
│   │   ├── markdown.ts
│   │   ├── page.css
│   │   ├── page.html
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

`src/app/diglot-store.ts` fetches the bundles and applies them, and `src/app/diglot-document.ts` turns that into signals. In `src/app/app.routes.ts`, the `/:locale` routes read the language from the route parameter, and the `/picker` routes read it from a signal that the language menu sets. `src/app/page.ts` reads its page with `diglotDocument()`, renders it with [marked](https://marked.js.org), and shows a notice when the report says that some text is still in English. `src/app/app.routes.server.ts` prerenders every page in every locale.

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

`pnpm build` prerenders twelve pages: `/en`, `/en/guide` and `/en/about`, the same three under `/fr` and `/tr`, and three under `/picker`, plus a redirect at `/`. A link at the top of each page switches between the language in the URL and the language picker. Pages under `/picker` keep the URL when the language changes, so only their English versions are prerendered.

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

Read the [Angular recipe](https://diglot.sh/guide/how-to/translate-an-angular-app) for a walk through the code, and the [Review UI docs](https://diglot.sh/review-ui/overview) for what the x18n plugin adds.
