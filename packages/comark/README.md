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
- `extract(doc, { spanSources: false })` skips slicing and re-rendering protected spans. Links, inline code, images, components and inline HTML get empty markdown in their placeholders, which changes each segment's `text` and `sourceHash`; `hash`, `skeleton`, placeholder types and `words` are the same. Use it when only identities are needed, as for a manifest.
- `apply(doc, translations, { policy })` returns a translated copy. Each translation is validated against the current source segment; placeholders are filled with the current source nodes, so links, code and components always come from the source. Rejected and missing segments keep their source text. Heading ids are kept. Code comments are substituted in the code text, including code already split into highlighted spans.
- `apply(doc, translations, { onSegment })` calls `onSegment` with an [`ApplySegmentEvent`](../core#apply-events) for each segment. `target.setAttribute(name, value)` sets a prop on the text block holding the segment (`h1` to `h6`, `p`, `li`, `blockquote`, `th`, `td`). Text directly inside a component is wrapped in a `span` that carries the attributes; it is left unwrapped when no attribute is set. Frontmatter, props, image alts, code labels and code comments have a `null` target. Span sources are resolved for `onSegment` only; pass `spanSources: false` when the callback does not read them (`hash`, `words` and `skeleton` are unaffected).

  ```ts
  const events: ApplySegmentEvent[] = []
  const { doc: translated } = await apply(doc, segment => records.get(segment.hash), {
    onSegment(event) {
      events.push(event)
      if (event.outcome === 'missing' || event.outcome === 'rejected')
        event.target?.setAttribute('lang', 'en')
    },
  })
  const coverage = wordsByStatus(events)
  ```

- `render(doc)` writes comark markdown, with hard breaks as `:br` and bound HTML attributes such as `:zoom="false"` intact.
- `extractNavigation(source)` and `applyNavigation(source, translations)` handle `.navigation.yml` files.
