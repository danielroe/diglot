# @diglot/comark

[comark](https://comark.dev) adapter for [diglot](../../README.md): extracts segments from comark documents and applies translations to them.

```bash
pnpm add @diglot/comark @diglot/core
```

## Usage

```ts
import { apply, extract, parse, render } from '@diglot/comark'

const doc = await parse(markdown)
const { segments } = await extract(doc, { file: 'docs/intro.md' })

const translations = new Map([[segments[0].hash, 'Introduction']])
const { doc: translated, report } = await apply(doc, translations)
// report: { applied, missing, rejected }

const output = await render(translated)
```

- `parse(source)` parses with the options the adapter expects and keeps the source and top-level line ranges, so protected spans (inline code, links, components, inline HTML) are taken verbatim from the source. Documents parsed elsewhere work too; their protected spans are re-rendered.
- `extract(doc, { file, policy })` returns segments for headings, paragraphs, list items, table cells, blockquotes, component slots, image alts, allowlisted props, prose frontmatter, code labels and code comments.
- `apply(doc, translations, { policy })` returns a translated copy. Each translation is validated against the current source segment; placeholders are filled with the current source nodes, so links, code and components always come from the source. Rejected and missing segments keep their source text. Heading ids are kept. Code comments are substituted in the code text, including code already split into highlighted spans.
- `render(doc)` writes comark markdown, with hard breaks as `:br` and bound HTML attributes such as `:zoom="false"` intact.
- `extractNavigation(source)` and `applyNavigation(source, translations)` handle `.navigation.yml` files.
