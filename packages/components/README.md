# @diglot/components

Translate the text of Vue, React and Svelte components without keys or `t()` calls. You write plain text in your components. At build time, a Vite plugin makes each run of text a [diglot](../../README.md) segment, rewrites the component to render it through a small runtime, and loads the translations from the records of a translations repository.

```bash
pnpm add @diglot/components
```

Each framework needs its parser: `@vue/compiler-sfc` for Vue (it comes with `vue`), `oxc-parser` for React, and `svelte` for Svelte.

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
createRoot(root).render(<DiglotProvider diglot={diglot}><App /></DiglotProvider>)
```

```svelte
<!-- Svelte: the root component -->
<script>
  import { createDiglot, setDiglot } from '@diglot/components/svelte'
  import translations from 'virtual:diglot'

  setDiglot(createDiglot({ ...translations, locale: 'fr' }))
</script>
```

`await diglot.setLocale('de')` loads the catalog of a locale and switches to it, and every component re-renders. Deeper in your app, `useDiglot()` (Vue and React) and `getDiglot()` (Svelte) return the state for a locale switcher. On the server, create one per request and await `diglot.ready` before you render. For the types of `virtual:diglot`, add `@diglot/components/client` to `types` in your `tsconfig.json`.

## What is translated

- Text, with the elements and expressions inside it. `Read the <a href="/docs">docs</a>, {{ name }}` is the segment `Read the {0}docs{/0}, {1}`: an element that wraps text becomes a paired placeholder, and an expression, a component or an element such as `<code>` or `<br>` becomes an atomic one.
- The attributes people read: `title`, `alt`, `placeholder`, `label`, `aria-label`, `aria-description`, `aria-placeholder` and `aria-roledescription`, when their value is static.
- Elements with `translate="no"` stay as they are, as does the content of `code`, `pre`, `kbd`, `samp`, `var`, `svg`, `math`, `script`, `style` and `textarea`, and of Vue's `v-pre`.

A sentence ends at an element that can't sit inside one, such as a `<div>`, and at a conditional or repeated element (`v-if`, `v-for`, `{#if}`, JSX inside `{…}`). Text keeps the whitespace its framework renders, and its segment is the same text with whitespace collapsed, so the same text has one hash in every component and every framework. Text that holds placeholder syntax such as `{0}` is left alone, and the plugin warns about it.

Segments are `plain`: text runs are `html-block` units and attributes are `prop` units, with the attribute name as `detail`. React attributes are translated inside components only, where the rewrite can call a hook.

## Translations

Translations are diglot records. List your components in `sources.yml`, extract them with `diglot extract`, and translate them like any other source:

```yaml
# translations/sources.yml
sources:
  - name: app
    path: ..
    include: ['src/**/*.vue']
```

The plugin builds each catalog from the records of its locale, for the segments of every component under the Vite root. A translation that fails validation, or that a reviewer rejected, is left out, and its text stays in the source locale. During `vite dev`, a change to a record reaches the page without a reload.

`@diglot/x18n` lists the segments of components and finds them in your source files, like those of Markdown documents.

## API

- `extract(code, { file, policy })` returns the segments of a component. `file` picks the parser by its extension: `.vue`, `.jsx`, `.tsx` or `.svelte`.
- `transform(code, { file, policy })` also returns the rewritten `code`, its source `map`, and the runs it `skipped`. It returns `undefined` for other files and for Vue templates in a language other than HTML.
- `isComponent(file)` and `extensions` tell which files the package reads.
