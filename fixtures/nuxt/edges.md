---
title: Edge cases
description: Excerpts of Nuxt docs that exercise parser edges.
links:
  - label: Source
    to: https://github.com/nuxt/nuxt
---

## Heading with `code` and a [link](/docs/api)

Beware that using only `$fetch` will not provide [network calls de-duplication](/docs/getting-started/data-fetching#dedupe). :br
Named parent routes take priority. :br Use `~/pages/foo/index.vue` instead.

You can also use a function to conditionally transpile. The function will receive an object ({ isDev, isServer, isClient, isModern, isLegacy }).

- **Type**: `array`
- **Default:** `false`

::warning
Do not import from `#app` in server code. Use :badge[v4.1]{color="info"} or <kbd>Ctrl</kbd> instead.
::

::card
---
icon: i-simple-icons-github
title: Nuxt Vercel ISR
to: https://github.com/danielroe/nuxt-vercel-isr
---
Example of a Nuxt application with hybrid rendering deployed on Vercel.
::

::code-group{sync="pm"}
```bash [npm]
# Install the module first
npm i @nuxt/fonts
```
```bash [pnpm]
pnpm add @nuxt/fonts
```
::

```vue [Directory Structure]
<template>
  <!-- Render the current page here -->
  <NuxtPage />
</template>

<script setup lang="ts">
// Fetch the data on the server
const { data } = await useFetch('/api/hello') // runs once
// ^?
</script>
```

| Option | Description |
| --- | --- |
| `ssr` | Whether to render on the server, see [rendering](/docs/guide/concepts/rendering). |
| <img alt="Nuxt latest version" src="/badge.svg" :zoom="false"> | Version badge |

![The Nuxt logo](/logo.svg)
