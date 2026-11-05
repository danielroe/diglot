---
title: Guide
description: How the pages of this site are written and translated.
---

## Write a page

Every page is a Markdown file in `src/content/docs`. Its frontmatter holds a `title` and a `description`, and both are translated together with the text.

## Add code

Code stays exactly as you write it, but its comments are translated:

```ts
// Load the translated pages next to the English ones.
const docs = await getCollection('docs')
```

## Check what is missing

Run `pnpm translations:status` to see how much of each language is translated.
