# @diglot/components

Translate the text of Vue, React and Svelte components without keys or `t()` calls. You write plain text in your components. At build time, a Vite plugin makes each run of text a [diglot](../../README.md) segment, rewrites the component to render it through a small runtime, and loads the translations from the records of a translations repository.

```bash
pnpm add @diglot/components
```

Each framework needs its parser: `@vue/compiler-sfc` for Vue (it comes with `vue`), `oxc-parser` for React, and `svelte` for Svelte. `.jsx` and `.tsx` files are read as React when your Vite config uses the React plugin. Install the parsers in the translations repository too, for `diglot extract`.

## Usage

Add the plugin to your Vite config, before the plugin of your framework:

```ts
// vite.config.ts
import diglot from '@diglot/components/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [diglot({ translations: './translations' }), vue()],
})
```

`translations` is the directory of the translations repository, the one that holds `diglot.config.ts`, relative to the Vite root. Without it, components render in the source locale. `sourceLocale` defaults to `en`.

Then create the locale state in your app. `virtual:diglot` holds the source locale and a loader for the catalog of each locale that `diglot.config.ts` lists:

```ts
// Vue: main.ts
import { createDiglot } from '@diglot/components/vue'
import translations from 'virtual:diglot'

const diglot = createDiglot({ ...translations, locale: 'fr' })
createApp(App).use(diglot).mount('#app')
```

```tsx
// React: main.tsx
import { createDiglot, DiglotProvider } from '@diglot/components/react'
import translations from 'virtual:diglot'

const diglot = createDiglot({ ...translations, locale: 'fr' })
createRoot(document.getElementById('root')!).render(<DiglotProvider diglot={diglot}><App /></DiglotProvider>)
```

```svelte
<!-- Svelte: the root component -->
<script>
  import { createDiglot, setDiglot } from '@diglot/components/svelte'
  import translations from 'virtual:diglot'

  setDiglot(createDiglot({ ...translations, locale: 'fr' }))
</script>
```

`await diglot.setLocale('de')` loads the catalog of a locale and switches to it, and every component re-renders. Deeper in your app, `useDiglot()` (Vue and React) and `getDiglot()` (Svelte) return the state for a locale switcher. `diglot.locale` is reactive in Vue and React. Anywhere, `diglot.subscribe(listener)` calls `listener` after each change, for a Svelte switcher or to keep `<html lang>` in step:

```ts
diglot.subscribe(() => document.documentElement.lang = diglot.locale)
```

For the types of `virtual:diglot`, add `@diglot/components/client` to `types` in your `tsconfig.json`.

### Server rendering

On the server, create one state per request, so that requests never share a locale, and give it the catalog of its starting locale, so that the page renders in that locale and hydrates without a mismatch. Load the catalog where your framework lets you wait, and pass it as `messages`:

```ts
const catalog = await translations.locales[locale]?.()
const diglot = createDiglot({ ...translations, locale, messages: catalog ? { [locale]: catalog } : {} })
```

In SvelteKit, do this in a universal `+layout.ts` `load` function and create the state in the root `+layout.svelte` with the data it returns. Outside a component you can also await `diglot.ready`, which settles once the starting catalog is loaded.

### Nuxt

Add the plugin to `vite.plugins` in `nuxt.config.ts`. The Vite root of Nuxt is the `app` directory, so a translations repository next to it is `'../translations'`. Then install the runtime in a Nuxt plugin: load the catalog of the request's locale on the server, keep it in `useState` so the client hydrates from the payload, and pass it as `messages`. The [docs](https://diglot.sh/integrations/components#nuxt) show the whole plugin.

### Tests

Vitest reads your Vite config, so it rewrites your components too. In Vue, install the runtime when you mount them, for example with `global: { plugins: [createDiglot()] }` in Vue Test Utils. React and Svelte components render in the source locale without a provider.

## What is translated

- Text, with the elements and expressions inside it. `Read the <a href="/docs">docs</a>, {{ name }}` is the segment `Read the {0}docs{/0}, {1}`: an inline element or a router link that wraps text becomes a paired placeholder, and an expression, a component without content, or an element such as `<code>` or `<br>` becomes an atomic one.
- The attributes people read: `title`, `alt`, `placeholder`, `label`, `aria-label`, `aria-description`, `aria-placeholder` and `aria-roledescription`, when their value is static.
- Elements with `translate="no"`, and Vue elements with `v-pre`, stay as they are. So does the content of `code`, `pre`, `kbd`, `samp`, `var`, `svg`, `math`, `script`, `style` and `textarea`, though their readable attributes are translated. Use `translate="no"` for names, such as your brand.

Only markup is read. Strings in your scripts, and strings in expressions such as `{{ ok ? 'Yes' : 'No' }}` or `label={'Save'}`, stay as they are.

A sentence ends at an element that can't sit inside one, such as a `<div>` or a component with content, and at a conditional or repeated element (`v-if`, `v-for`, `{#if}`, JSX inside `{…}`). Text keeps the whitespace its framework renders, and its segment is the same text with whitespace collapsed, so the same text has one hash in every component and every framework. Text that holds placeholder syntax such as `{0}` is left alone, and the plugin warns about it.

The rewrite adds names that start with two underscores, such as `__diglot`, and Svelte's `Diglot__Text`, so keep those names out of your components. A translation can reorder placeholders: each keeps its identity, so the state of a component or an input inside one survives.

Segments are `plain`: text runs are `html-block` units and attributes are `prop` units, with the attribute name as `detail`.

React text and attributes are translated in client components only: server components, such as async ones, can't render `<DiglotText>` or call the hook. In React, the rewrite calls a hook in function components, including those passed to `memo()` and `forwardRef()`, so attributes are translated inside them only, and the plugin warns about the others, such as attributes in class components. A capitalised function that the module calls, or passes to a method as in `items.map(Row)`, is a helper, not a component, and so is an async function. Text renders through `<DiglotText>`, which needs no hook, except in `<title>` and `<option>`, which only take strings, so their text is translated inside function components only and the plugin warns about the others. Give an `<option>` a `value`, so that what a form submits doesn't change with the locale.

## Translations

Translations are diglot records. List your components in `sources.yml`, extract them with `diglot extract`, and translate them like any other source:

```yaml
# translations/sources.yml
sources:
  - name: app
    path: ..
    include: ['src/**/*.{vue,tsx,svelte}']
    exclude: ['**/*.test.*']
```

The plugin builds each catalog from the records of its locale, for the segments of every component under the Vite root. A translation that fails validation, or that a reviewer rejected, is left out, and its text stays in the source locale. During `vite dev`, a change to a record reaches the page without a reload.

`@diglot/x18n` lists the segments of components and finds them in your source files, like those of Markdown documents.

## API

- `extract(code, { file, policy })` returns the segments of a component. `file` picks the parser by its extension: `.vue`, `.jsx`, `.tsx` or `.svelte`.
- `transform(code, { file, policy })` also returns the rewritten `code`, its source `map`, and the runs it `skipped`. It returns `undefined` for other files and for Vue templates in a language other than HTML.
- `isComponent(file)` and `extensions` tell which files the package reads.
