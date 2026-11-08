# @diglot/astro

An [Astro](https://astro.build) integration and content loader for [diglot](../../README.md) translations. You add the integration to your Astro config and use the loader for a collection in place of Astro's `glob()` loader. Next to your source pages, the loader then adds translated entries for the locales of your `i18n` config, built from the records of a translations repository, so your site never holds translated copies of its pages.

```bash
pnpm add @diglot/astro
```

Add the integration in `astro.config.mjs`, next to `mdx()` when your pages include MDX:

```js
import mdx from '@astrojs/mdx'
import diglot from '@diglot/astro'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [mdx(), diglot({ translations: './translations' })],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
  },
})
```

Then use the loader for a collection in `src/content.config.ts`:

```ts
import { diglotLoader } from '@diglot/astro'
import { defineCollection } from 'astro:content'

const docs = defineCollection({
  loader: diglotLoader({
    pattern: '**/*.{md,mdx}',
    base: './src/content/docs',
  }),
})

export const collections = { docs }
```

`diglot()` takes `translations`, the directory of the translations repository relative to the project root, and `diglotLoader()` takes the `pattern`, `base` and `generateId` options of `glob()`. The locales come from your `i18n` option: every locale other than the default is translated when `diglot.config.ts` lists it too, and case doesn't matter, so `pt-br` and `pt-BR` are the same locale. Set `parser: 'satteri'` in the translations repository, because it reads Markdown the way Astro does, and extract again whenever you change the parser or the policy.

A locale gets a page as soon as at least one translation applies to it, and text without a usable translation stays in the source language. A page you write for a locale yourself is used as it is. MDX pages need [`@astrojs/mdx`](https://docs.astro.build/en/guides/integrations-guide/mdx/), and their components, relative imports and images work the same way as in the source. During `astro dev`, changes to the records, the configuration or a source page show up without a restart.

`diglotLoader()` also takes a `data` function, which returns fields to add to each translated entry. It receives the entry's `id`, `locale`, `localePath`, `source` file and translated `frontmatter`, and `updatedAt`, the date of the newest translation that the page uses.

For a Starlight site, use [`@diglot/starlight`](../starlight), which sets up the integration for Starlight.

The package needs Astro 7 and Node.js 22.23.4 or later. It translates pages with YAML frontmatter in content collections.

See the [Astro integration docs](https://diglot.sh/integrations/astro) for entry ids, hand-written pages and limitations, and [`examples/astro`](../../examples/astro) for a site in English, German and Japanese.
