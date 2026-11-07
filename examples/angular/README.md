# diglot Example: Angular

A small [Angular](https://angular.dev) app, written in English and translated into French and Turkish by [diglot](../../README.md). Its pages are Markdown files, and [`@diglot/angular`](../../packages/angular) applies the bundle of `translations`, a translations repository that lives inside the app, when a page loads. Every page is prerendered in all three locales.

> 🧑‍🚀 **Running it from this repository?** Install from the root of the diglot repository, so that the example uses the local diglot packages.

## 🚀 Project Structure

```text
/
├── public/
│   └── favicon.svg
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
│   └── sources.yml
├── angular.json
└── package.json
```

`src/app/app.config.ts` sets up diglot with `provideDiglot()` and reads the locale from the `:locale` route parameter. `src/app/page.ts` reads its page with `diglotDocument()`, renders it with [marked](https://marked.js.org), and shows a notice when the report says that some text is still in English. `src/app/app.routes.server.ts` prerenders every page in every locale.

The French and Turkish records live in `translations/fr/segments` and `translations/tr/segments`. Every page is translated, except one paragraph of the about page, so that page shows the partly-translated notice in both languages.

## 🧞 Commands

Run these from the example's directory:

| Command | Action |
| :--- | :--- |
| `pnpm start` | Extracts the segments, builds the bundle and starts the dev server at `localhost:4200` |
| `pnpm build` | Extracts the segments, builds the bundle and prerenders the app to `dist/` |
| `pnpm translations` | Extracts the segments and builds the bundle in `translations/dist` |
| `pnpm translations:status` | Shows how much of each locale is translated |

The dev server doesn't watch `translations`. After you edit a record, run `pnpm translations` and reload the page.

`pnpm build` prerenders nine pages: `/en`, `/en/guide` and `/en/about`, and the same three under `/fr` and `/tr`.
