---
title: Guide
description: How the pages of this app are written and translated.
---

## Write a page

Every page is a Markdown file in `src/content/docs`. Its frontmatter holds a `title` and a `description`, and both are translated together with the text.

## Add code

Code stays exactly as you write it, but its comments are translated:

```ts
// Read the page in the language of the current route.
const doc = diglotDocument(() => slug())
```

## Check what is missing

Run `pnpm translations:status` to see how much of each language is translated.
