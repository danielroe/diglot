# @diglot/core

The parser-neutral core of [diglot](../../README.md): the segment model, placeholder form and hashing, translation validation, apply helpers, segment and sentence diffs, translation records, and policy and glossary types. It has no markdown parser dependency; adapters such as [`@diglot/comark`](../comark) and [`@diglot/mdast`](../mdast) produce segments for it. It imports no Node built-ins, so it runs in browsers and edge runtimes as well as Node.

```bash
pnpm add @diglot/core
```

## Segments

An adapter converts each translatable unit into a `SegmentDraft` with inline content in a small IR (`text`, `strong` / `emphasis` / `delete`, `link` with its opening and closing markdown, and `atomic` spans with their markdown source). `buildSegment` turns it into a `Segment`:

```ts
import { buildSegment } from '@diglot/core'

const segment = buildSegment({
  kind: 'paragraph',
  content: [
    { type: 'text', value: 'Nuxt is powered by ' },
    { type: 'link', open: '[', close: '](https://nitro.build)', children: [{ type: 'text', value: 'Nitro' }] },
    { type: 'text', value: '.' },
  ],
  context: { headingTrail: [], containers: [] },
  position: { startLine: 1, endLine: 1, precision: 'node' },
}, { file: 'intro.md', index: 0 })

segment.skeleton // 'Nuxt is powered by {0}Nitro{/0}.'
segment.hash // sha256 of the skeleton, truncated to 16 hex characters
```

`{n}` stands for an atomic span (inline code, image, component, HTML, binding, hard break) and `{n}...{/n}` wraps the text of a link. Whitespace is collapsed and markdown punctuation in text is escaped, so the skeleton is stable across re-wrapping and protected span edits. Plain segments (props, frontmatter, labels, code comments) hash apart from markdown segments with the same skeleton, so each translation validates under one set of rules. A policy can add a context salt to the hash of ambiguous short strings.

## Validation

```ts
import { validate } from '@diglot/core'

validate('Nuxt est propulsé par {0}Nitro{/0}.', segment).ok // true
validate('Nuxt [Vite](https://example.com)', segment).errors // link syntax, missing placeholder
```

A translation may contain text, emphasis markers and the placeholders of its source. Repeated code placeholders are a warning. Plain segments (props, frontmatter, labels, code comments) are single-line and may not add markup; code comments may not contain comment terminators.

`resolveTranslation(segment, translations)` looks up a translation by hash, validates it and re-injects the protected spans of the current source. Translations are skeletons or `TranslationRecord`s, in a map keyed by hash or returned by a lookup function. `parseSkeleton` turns a validated skeleton into a tree for adapters that apply translations to an AST. `pseudoTranslate` produces a valid pseudo-locale translation of any skeleton.

## Apply events

The adapters' `apply` functions accept `onSegment`, called with an `ApplySegmentEvent` for each segment in extraction order:

- `segment`: the source segment, with its `hash` and `words`
- `outcome`: `translated`, `missing` (no translation), `rejected` (a reviewer rejected the translation or it failed validation; `errors` lists why) or `skipped` (no translation and nothing to translate). Segments that are not translated keep their source text
- `record`: the record the lookup returned, if any
- `status`: what a reader sees, as from `recordStatus`. Translations given as bare skeletons have no status
- `target`: for block-level segments, a handle whose `setAttribute(name, value)` sets an attribute on the output node; `null` for frontmatter, props, image alts, code labels and code comments

`wordsByStatus(events)` sums segment words by status, for per-page coverage. `createSegmentEvent` builds an event for adapters.

## Changes

```ts
import { diffSegments, sentenceDiff } from '@diglot/core'

const { unchanged, added, removed, modified } = diffSegments(before, after)
for (const { before, after, similarity, ambiguous } of modified)
  console.log(sentenceDiff(before.skeleton, after.skeleton).changed)
```

`diffSegments` compares the segments of one file: equal hashes are unchanged, and the remaining removed and added segments are paired by skeleton similarity (threshold `0.5` by default) to find each modified segment's predecessor.

## Records

`TranslationRecord` is one translation of one source segment into one locale: `hash`, `source`, `text`, `origin` (`mt`, `tm`, `human`), `review` (`none`, `edited`, `verified`, `rejected`), `derived` (`fresh`, `carry`, `update`), and optionally `prev`, `salt`, `mt` (model, prompt version and the unedited candidate), `by`, `verifiedBy`, `rejectedBy` and `updatedAt`.

A reviewer rejects a translation by setting `review: 'rejected'` and `rejectedBy: { by, at }` on its record. The text is kept for reviewers and metrics, but readers see the source text, and machine translation leaves the record alone. An edit (`review: 'edited'`, without `rejectedBy`) or a new source hash replaces it.

- `parseRecord(value)` checks the shape and throws `RecordError`. `verifiedBy` is required when `review` is `verified`; `rejectedBy` is required when `review` is `rejected`, and allowed only then
- `createRecord({ segment, text, origin })` fills identity fields
- `recordStatus(record, segment)` returns what a reader sees: `untranslated`, `machine`, `pending-review`, `edited`, `verified` or `rejected` (a rejected record, or a text that fails validation against `segment`). A record carried or updated from a predecessor is `pending-review` until someone edits or verifies it, whatever its `origin`
- `editRatio(record)` measures how much of the machine candidate a reviewer changed

## Configuration

`defineConfig` types a `diglot.config.ts`; `defaultPolicy` lists the prose props, layout containers and frontmatter paths extracted by default (a dotted path such as `navigation.title` matches a literal `navigation.title` key or a nested `navigation: { title }`, and translations are written back to the key that was read); `Glossary` describes a per-locale `glossary.yml` and `LocaleStyle` a per-locale `style.yml`; `MtConfig` holds the machine translation settings; `LocaleState` describes a per-locale `locale.yml` with the machine translation switch and the review metrics behind it.
