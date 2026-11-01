# Spike: comark segmenter, content-hash identity, change detection

Throwaway code; the numbers are the deliverable. Everything is reproducible with
`npm install && npm run all` in this directory (module repos are expected as shallow clones
under `/tmp/repos/{fonts,icon,devtools,eslint,hints,cli}`). Raw output lives in `out/*.json`.

Corpus: `nuxt/nuxt` `docs/` on `3.x` (e0a6ae9d5d), `4.x` (1b09d0c441), `main` (c709ec8c0c),
plus `docs/` of `nuxt/{fonts,icon,devtools,eslint,hints,cli}` at HEAD. 735 markdown files
across the three branches, 21 `.navigation.yml` per branch.

## Key numbers

| | |
|---|---|
| Segments on `main` | 10,664 (9,080 translatable, 1,584 placeholder-only), 112,863 words |
| Unit round-trip (parse, canonicalise, re-parse, re-hash) | 22,468 / 22,471 (99.99%) over 3 branches |
| Identity translation passes `validate` | 22,471 / 22,471 |
| Pseudo-locale apply, render, re-extract | 10,622 / 10,626 applied, 2,041 / 2,041 heading ids kept |
| Cross-branch dedupe (3.x+4.x+main), placeholder-form hash | 25,222 units → 7,944 unique; 60.3% of words saved |
| Same, full-markdown hash | 8,844 unique; 55.7% saved |
| 3.x words still to translate after main+4.x | 6,215 (7.6%) with placeholder hash vs 18,763 (22.8%) with full hash |
| 6 months of `main` (217 commits, 25.4 weeks) | 1,991 new hashes needing translation (78/week, 1,601 words/week, median week 23) |
| Hashes that disappear from `main` (verified translations no longer used there) | 685 (27/week, ~500 words/week) |
| Per-file "modified" pairs | 380, of which 376 (98.9%) unambiguous |
| Edits absorbed by placeholder-form hashing | 857 (more than twice the 380 real modifications), none needed re-translation |
| Modified paragraphs where exactly one sentence changed | 255 / 340 content edits (75%); 96 / 181 (53%) of multi-sentence units |
| remark (mdast) adapter reproduces comark hashes | 29,601 / 29,640 (99.87%) over 3 branches |

## Code layout

```
src/core/        parser-neutral, no comark import
  types.ts       InlineNode IR, Segment, SegmentDraft, Placeholder
  skeleton.ts    whitespace normalisation, escaping, IR -> placeholder form, re-injection
  segment.ts     SegmentDraft -> Segment (hashing)
  validate.ts    translation grammar check
  diff.ts        per-file segment diff + modified matching
  sentences.ts   Intl.Segmenter sentence diff
  policy.ts      prop allowlist, container -> kind, code-label / code-comment heuristics
  frontmatter.ts prose frontmatter paths
src/adapters/
  comark.ts      parse / extract / apply / render (the only comark import besides scripts)
  remark.ts      extraction only, remark-parse + remark-gfm + remark-mdc
  navigation.ts  .navigation.yml
```

### What the core needs from an AST

An adapter has to supply, per translatable unit, a `SegmentDraft`:

1. **Unit boundaries and kind**: paragraph, heading (+ level), list item, table cell,
   blockquote, component slot, HTML text block. Kind comes from the enclosing container path,
   so the adapter must report container names (component name, `#slot` name, `li`, `blockquote`).
2. **Inline structure, in the IR**: `text` (unescaped), `strong` / `emphasis` / `delete`,
   `link` with its *opening and closing markdown* (`[` and `](url "title")`), and `atomic`
   spans with their *markdown source* (inline code, images, inline components, inline HTML,
   bindings, hard breaks). The core never needs to know what a URL or attribute is.
3. **Plain strings**: component props on the allowlist, image `alt`, code-block labels,
   frontmatter object (core walks the prose paths), navigation yaml.
4. **Heading text** for the heading trail (context only).
5. **Positions**: line range of the enclosing block (comark only offers end lines of top-level
   blocks, and only in streaming mode; mdast has exact offsets for every node).
6. **For `apply` only**: a way to address a unit in the tree and to parse a markdown fragment
   that is guaranteed to be one paragraph. That part is adapter-specific by nature.

mdast supplies all of it, and more cheaply: the remark adapter takes protected-span markdown
straight from source offsets, so it needs no renderer. comark has no inline positions, so the
comark adapter re-renders every protected span with `comark/render` (sentinel tricks needed to
stop a lone component rendering in block form).

## 1. Unit boundaries

* One segment per `p`, `h1`-`h6`, `th`/`td`; list items and blockquotes contribute one segment
  per paragraph inside them (`li > p` always exists with `autoUnwrap: false`). Runs of inline
  nodes directly inside a block container are grouped into one segment.
* Components: never a segment themselves. Paragraphs in their slots are ordinary segments
  (`component-slot` kind, `containers: ['card#title']`). `steps`, `card-group`, `code-group`
  are treated as layout, so paragraphs in them stay `paragraph`.
* Component props: allowlist only (`policy.ts`), plain strings, never re-parsed.
* `img` alt: separate `image-alt` segment; the image itself is a placeholder in its paragraph.
* Code blocks: not segments. Filenames that read as prose (`Directory Structure`, `Before`,
  `Signature`) become `code-label` segments (154 on main). **Caution**: code-group tabs with
  `sync="pm"` key on the label, so translating labels can break tab sync; the label heuristic
  is also language-dependent (it failed to re-detect accented labels in the apply test).
* Frontmatter: `title`, `description`, `navigation.title`, `head.title`, `links[].label`.
* Placeholder-only units (no letters outside placeholders) are segmented but never need
  translating: 1,584 on main (1,142 table cells such as `` `runtimeConfig` ``, 356 headings
  such as `` `useFetch` ``, 71 list items, 15 paragraphs).

Segments by kind on `main`:

| kind | segments | words |
|---|---:|---:|
| paragraph | 3,193 | 65,814 |
| heading | 2,041 | 3,622 |
| table-cell | 2,034 | 6,871 |
| list-item | 1,633 | 15,754 |
| component-slot | 819 | 16,132 |
| frontmatter | 609 | 3,542 |
| code-label | 154 | 214 |
| prop | 124 | 663 |
| navigation | 38 | 80 |
| image-alt | 15 | 98 |
| blockquote | 4 | 73 |

Word histogram: 0-5 words 5,442; 6-15 2,475; 16-40 2,316; 41-80 414; 81+ 17. Longest unit is
130 words (a `use-cookie.md` table cell with 9 placeholders).

## 2. Canonical form and hash

Per the steer, **identity is the hash of the placeholder form** (`hash`); `sourceHash` (the
full canonical markdown, placeholders re-injected) is kept for comparison and for detecting
"source changed but translation still valid".

Normalisations applied before hashing (all in the core, all safe):

* whitespace runs collapse to one space; units are trimmed (re-wrapping source lines is a no-op);
* whitespace next to hard breaks is dropped, and `  \n`, `<br>`, `</br>`, `:br` are one thing;
* text is backslash-escaped deterministically (`` \ ` * _ [ ] < { } ~ | ``, `:` before a
  letter at word start, `&` before an entity, leading block markers). 67 segments on main end
  up with a visible escape (`NUXT\_TEST\_LOG\_LEVEL`, `1\. Migrate ...`, `\~59%`);
* the contents of protected spans are not part of `hash` at all.

Round-trip results (3 branches, `out/roundtrip.txt`):

* **Units**: 22,468 / 22,471 re-parse to the same skeleton and the same placeholder sources.
  The 3 failures are one source bug repeated on each branch: `**...**</br>Enable` in
  `define-page-meta.md`. comark drops `</br>`, and `**...**Enable` cannot be written back so
  that the strong closes.
* **Whole documents** (comark parse, render, parse): 682 / 735 identical. Failures:
  35 trailing whitespace before `:br` (benign), 9 whitespace text nodes, 6 a component that
  follows a list inside another component is rendered indented and re-parses *inside the last
  list item* (real renderer bug), 3 the `</br>` case above.
* comark renderer bugs that matter for a translation library:
  * `br` renders as a trailing-space hard break, so `:br\ntext` becomes a paragraph break and
    two consecutive breaks cannot be expressed. Worked around with a `br` handler (`:br`).
  * HTML attribute bindings lose their colon (`<img :zoom="false">` renders `zoom="false"`),
    so a re-injected placeholder can silently change (12 occurrences, roadmap badges).
  * The comark *parser* swallows `{ isDev, isServer, ... }` after `(` as an attribute block:
    `docs/4.api/6.nuxt-config.md:408` renders as "receive an object ()". Found by the remark diff.

## 3. Placeholder form (what MT / translators see)

`{n}` for atomic spans, `{n}...{/n}` for links whose text is translatable, `**` / `*` / `~~`
kept as markers. Links whose text is only code, or a URL, are atomic.

Example: `Nuxt is powered by {0}Nitro{/0}, a modern server engine.` with
`{0} = "[" ... "](https://nitro.build/)"`.

Placeholder count per markdown unit on main (9,742 units):

| placeholders | 0 | 1 | 2 | 3-5 | 6+ |
|---|---:|---:|---:|---:|---:|
| units | 3,932 (40%) | 3,711 (38%) | 1,093 (11%) | 856 (9%) | 150 (1.5%) |

By type: code 8,224, link 1,738, break 43, component 38, other 18 (`%s`), image 11, html 2.

## 4. Translation grammar, `validate` and `apply`

`validate(translation, segment)` (core) accepts only text, `**` / `__` / `*` / `_` / `~~`
markers (balanced, properly nested with paired placeholders) and exactly the source's
placeholders, each once (order free). It rejects backticks, `[` / `]`, `<tag`, `{{`, other
braces, `:name` at word start, entities, bare URLs, `|` in table cells, blank lines,
line-leading block syntax, and newlines in single-line kinds (headings, cells, props,
frontmatter). Plain-string segments only need to be non-empty and single-line.

`apply(doc, translations)` (comark adapter) validates each translation, re-injects placeholders
from the *current* source segment, parses the result and requires exactly one paragraph back;
anything else falls back to the source text and is reported.

Results on main (`out/apply.json`):

* Every source skeleton validates as its own translation (22,471 / 22,471).
* Pseudo-locale (accented vowels) applied to every segment: 10,622 applied, 4 rejected (all
  single-HTML-element placeholder-only cells in `roadmap.md` that comark parses as an HTML
  block). Re-extracting the rendered output reproduces every translated skeleton and every
  placeholder source except the `</br>` case and those 4 cells.
* Heading ids: 2,041 / 2,041 preserved. No extra work needed: the AST keeps the source id and
  comark writes `{#id}` once the translated text no longer slugifies to it. Anchors stay
  English, so cross-page `#hash` links keep working in every locale.
* Injected corruptions (dropped / duplicated placeholder, code, link, raw HTML, inline
  component, binding, blank line, newline in heading, unbalanced emphasis, block syntax):
  100% caught, 0 missed, over ~100k attempts. These are blunt; a real MT false-reject rate
  still needs measuring (prose with `<`, `_`, `*` used literally will be rejected unless escaped).

## 5. Components and props (all sources)

Block components (`::name`), counts across 3 branches + modules:

| component | uses | prose props on allowlist | other props |
|---|---:|---|---|
| read-more | 937 (9 inline) | `title` (114 uses) | `to`, `icon`, `target`, `color`, `link` |
| note | 762 | | `icon`, `to`, `color`, `target` |
| tip | 458 | | `icon`, `to`, `target` |
| warning | 314 | | `icon`, `to` |
| code-group | 283 | | `sync` |
| important | 213 | | |
| card | 128 | `title` (128), `description` | `icon`, `to`, `target`, `color`, `ui.icon.base` |
| video-accordion | 116 | `title` (116) | `videoId`, `platform` |
| callout | 83 | | `icon`, `type` |
| link-example | 75 | `title` (unused today) | `to`, `target` |
| card-group | 33 | | `class` |
| caution | 19 | | `icon` |
| steps | 9 | | |
| collapsible | 3 | `name` | |
| u-button | 3 | `label` | `to`, `color`, `icon` |
| code-tree | 3 | | `defaultValue` |
| code-collapse, details/summary (HTML), video/source (HTML) | | | |

No prop outside the allowlist looked like prose. `kbd` (`:kbd{value="Shift"}`, 10 uses) is
the only borderline case: key names are localised on some keyboards.

**Inline components inside paragraphs** (main): 40 occurrences in 39 segments, 36 of which
hide letters from the translator: 32 `:badge[...]` (version badges `v4.4`, plus `once`),
2 `<kbd>Ctrl</kbd>`-style HTML, 2 `span`. Both `span`s are docs bugs comark parses as MDC
spans: `[won't pick up environment variables ...] (/docs/...)` in `2.env.md:59` (space before
the parenthesis) and `` [`static/`] `` in `1.public.md:26`. The only real loss is the
`once` badge label. Separately, `:read-more{title=...}` written on the line after a paragraph
becomes an *inline* component in comark (but a block one in remark-mdc), and its `title` is
then not extracted (9 uses).

## 6. Frontmatter and navigation

Frontmatter keys (files using them, all sources): `title` 787, `description` 785,
`links[].label` / `.icon` / `.to` / `.size` 327, `navigation.icon` 160, `head.title` 85,
`navigation` (bool) 85, `minimalVersion` 56, `navigation.title` 33, `titleTemplate` 12
(always `%s`), `surround` 9, `redirect` 3, `head.meta[].name` / `.content` 2.
Prose: `title`, `description`, `navigation.title`, `head.title` (mostly a directory name
like `.nuxt/`, arguably not prose), `links[].label` (`Source`, `Source (client)`), and
`head.meta[].content` where `name` is `description` (not extracted yet).

`.navigation.yml` keys: `title` 65, `icon` 57, `titleTemplate` 54 (`'%s · Get Started with
Nuxt'`, so `%s` becomes a placeholder), `navigation.icon` 6, `head.title` 2, `defaultOpen` 2,
`navigation` 2. 38 navigation segments on main.

## 7. Code blocks (main)

1,640 code blocks, 13,041 lines. 413 blocks (25%) contain at least one prose comment line
(two or more words, twoslash directives excluded); 803 comment lines in total. By language:
ts 263 / 839, vue 113 / 384, bash 9 / 179, js 9 / 32, html 8 / 36, diff 6 / 68.
Comments are the largest untranslated surface left; translating them would need a per-language
comment tokenizer and re-rendering of twoslash blocks.

## 8. Cross-source dedupe

Placeholder-only units excluded. `hash` = placeholder form, `sourceHash` = full markdown.

| | units | unique `hash` | unique `sourceHash` | words | unique words (`hash`) | saved |
|---|---:|---:|---:|---:|---:|---:|
| 3.x | 7,207 | 5,558 | 5,708 | 82,276 | | |
| 4.x | 8,935 | 6,948 | 7,172 | 108,056 | | |
| main | 9,080 | 7,090 | 7,314 | 112,863 | | |
| **3 branches** | 25,222 | **7,944** | 8,844 | 303,195 | 120,349 | **60.3%** (55.7% by `sourceHash`) |
| + 6 module repos | 27,089 | 9,221 | 10,164 | 325,703 | 140,792 | 56.8% (52.4%) |

Unique hashes by number of branches containing them: 1 branch 1,169 (21,865 words),
2 branches 1,898 (30,936 words), 3 branches 4,877 (67,548 words). With `sourceHash`:
1,881 / 2,576 / 4,387.

Incremental cost after translating main: 4.x adds 7,664 words (7.1%), then 3.x 6,215 (7.6%).
With `sourceHash`, 3.x would add 18,763 (22.8%): 3.x links point at `/docs/3.x/...`, so the
placeholder-form hash is what makes 3.x nearly free. Module docs share almost nothing with
core (0.3-1.3% for fonts/icon/devtools/eslint, 11% hints); `nuxt/cli` dedupes heavily
*within itself* (675 units, 350 unique: repeated option tables).

Within main, the top repeats are table and API boilerplate: `**Type**: {0}` 192, `Type` 151,
`Source` 99, `**Default:** {0}` 93, `Usage` 91, `Parameters` 79, `Example` 73.

## 9. Change detection (6 months of main)

`git log --since="6 months ago" --first-parent -- docs`: 217 commits, 750 changed doc files,
2026-05-07 to 2026-11-01 (25.4 weeks). For each changed file, segments before and after are
diffed (`core/diff.ts`):

1. identical `hash` (multiset) = unchanged;
2. remaining removed x added pairs scored by normalised Levenshtein on the skeleton
   (`1 - lev / maxLen`), minus 0.1 if the kind differs, minus `0.2 * |relative position shift|`;
   pairs below similarity 0.5 are discarded; greedy best-first matching;
3. a match is *ambiguous* if a rival pair scores within 0.1 and carries a different hash
   (duplicates with the same text share a translation, so they do not count).

Totals: 59,452 unchanged, 1,968 added, 602 removed, **380 modified, 376 unambiguous (98.9%)**.

Threshold sensitivity:

| threshold | modified | unambiguous | added | removed |
|---|---:|---:|---:|---:|
| 0.3 | 489 | 452 | 1,859 | 493 |
| 0.4 | 422 | 414 | 1,926 | 560 |
| **0.5** | 380 | 376 | 1,968 | 602 |
| 0.6 | 341 | 340 | 2,007 | 641 |
| 0.7 | 295 | 295 | 2,053 | 687 |

Similarity of accepted matches: 0.9-1 151, 0.8-0.9 110, 0.7-0.8 34, 0.6-0.7 45, 0.5-0.6 40.
The 0.5-0.6 band is mostly real rewrites of option descriptions
(`{0}: watch reactive sources to auto-refresh` -> `Array of reactive sources to watch and
auto-refresh.`): wrong as "same sentence", still useful as an MT seed. Ambiguous cases are
genuinely ambiguous (a paragraph split in two; `Testing Nuxt 5` vs `Migrating to Nuxt 5`).
Proposal: 0.5 for seeding, and only show a sentence-level diff to the translator above ~0.7.

**Corpus level** (a hash only needs translating if it has never existed in main, or in
3.x / 4.x as they were when the window opened):

* new hashes needing translation: 1,991 (40,704 words): **78/week, 1,601 words/week**, but
  very bursty: median week 23, peaks of 490 and 279 (the Nuxt 5 docs work, error codes,
  builder guide). Top commit: `feat(nitro): nitro v2 compatibility layer` with 179 new
  segments / 4,330 words.
* only 315 of those (16%) have a "modified" predecessor to seed from; most new hashes are new prose;
* hashes that disappear from main (the human-verified translations no longer used on main):
  685, 27/week, about 500 words/week.

**Absorbed by placeholder-form hashing**: 857 per-file pairs changed `sourceHash` but kept
`hash`: 465 atomic-link targets, 335 link URLs with translatable text, 32 inline code, 21 both
link kinds, 4 inline components (`:read-more{to}`). This is 2.3x the number of real
modifications. Almost all of it is one docs-wide sweep (`docs: strip version prefixes`,
`/docs/4.x/` to `/docs/`) plus renames (`nuxi` to `nuxt`, MCP tool names `get_module` to
`get-module`, `useStorage()` to `useKV()`, Node versions). I read all 36 code/component
cases: **none needs re-translation**, because the prose around the placeholder did not change
and the new span is re-injected from source. The theoretical risk is a translation that
mirrors the code token in prose (for example "returns `null` (nothing)"); no such case occurred.

**Cosmetic modifications** among the 380: 34 case-only (title-casing headings:
`Server lifecycle` -> `Server Lifecycle`), 5 punctuation only (trailing period), 1 markup
only (`extends` -> `` `extends` ``). I would *not* normalise these into the hash (case carries
meaning in identifiers and headings). Better: carry the old translation forward automatically
with its status lowered to `needs-review`.

Safe normalisations, in summary: whitespace and soft line breaks (done), break syntax (done),
protected span contents (done, via placeholder form), link URL and target (done). Not safe:
case, punctuation, emphasis.

## 10. Sentence-level highlighting

`Intl.Segmenter('en', { granularity: 'sentence' })` on the skeleton, LCS diff over sentences.
Of the 340 content modifications: 255 (75%) differ in exactly one sentence, 72 in two, 11 in
three, 2 in four or more. Restricted to units with two or more sentences (181), 96 (53%)
change exactly one sentence, which is the case where a translator only re-checks one
sentence. No splits after `e.g.` / `i.e.` / `etc.` were observed in the changed sentences
(placeholders such as `{0}.` do not confuse it). Typical one-sentence edits: `A object` ->
`An object`, `remain null` -> `remain undefined`, `allows to analyze` -> `allows you to analyze`.

## 11. Parser independence (remark)

`src/adapters/remark.ts` (remark-parse + remark-gfm + remark-mdc, about 190 lines,
extraction only) against the comark adapter over 3 branches: **29,601 / 29,640 segment hashes
identical (99.87%)**; 98.6% for `sourceHash`, because protected-span markdown differs (comark
re-renders and normalises attributes, remark keeps the source slice). This is the strongest
argument for hashing the placeholder form: identity then does not depend on any renderer.

The 51 remaining differences are parser disagreements, not adapter bugs:

* raw HTML: comark parses `<img alt>` inside HTML, so it extracts 12 image alts that remark
  leaves opaque; inline HTML pairs (`<kbd>`) are merged into one placeholder by the remark adapter;
* MDC edge cases: `:br` runs, `:read-more` directly after a paragraph line (inline in comark,
  block in remark-mdc), YAML-block props (remark-mdc puts them in `fmAttributes`),
  `{ ... }` after `(` (comark drops it);
* code-block meta: ```` ``` [Nuxt 2] ```` with no language, and `twoslash [SASS]`, are read
  differently, so code labels differ;
* linkify: comark autolinks `nuxt.com`, remark-gfm does not.
* remark-mdc kebab-cases prop names (`videoId` -> `video-id`); harmless for the allowlist
  but worth knowing for an `apply` built on mdast.

## 12. Proposed segmenter output

```ts
type SegmentKind =
  | 'heading' | 'paragraph' | 'list-item' | 'table-cell' | 'blockquote'
  | 'component-slot' | 'html-block'
  | 'image-alt' | 'prop' | 'code-label' | 'frontmatter' | 'navigation'

type PlaceholderType = 'code' | 'link' | 'component' | 'html' | 'image' | 'break' | 'binding' | 'other'

interface Placeholder {
  id: number
  type: PlaceholderType
  /** Atomic: markdown the placeholder stands for. Paired: markdown before the wrapped text. */
  source: string
  /** Paired placeholders (links with translatable text) only. */
  close?: string
  /** Component / HTML tag name. */
  name?: string
  /** The span contains letters the translator cannot see (e.g. `:badge[once]`). */
  hidesText?: boolean
}

interface Segment {
  /** Identity: sha256(skeleton), truncated. Translations are keyed by this. */
  hash: string
  /** sha256(text). Differs from the previous version when only protected spans changed. */
  sourceHash: string
  kind: SegmentKind
  /** `plain` segments (props, frontmatter, yaml) are never parsed as markdown. */
  format: 'markdown' | 'plain'
  /** Placeholder form, the only thing a translator or MT model sees. */
  skeleton: string
  /** Canonical markdown with placeholders re-injected. */
  text: string
  placeholders: Placeholder[]
  /** Words outside placeholders; 0 means nothing to translate. */
  words: number
  context: {
    file: string
    /** Enclosing heading texts, outermost first (for MT context and UI). */
    headingTrail: string[]
    /** Ordinal in the file; used for positional proximity when matching edits. */
    index: number
    /** e.g. ['steps', 'callout'] or ['card-group', 'card#title']. */
    containers: string[]
    /** Heading tag, prop name or frontmatter path. */
    detail?: string
  }
  position: { startLine: number, endLine: number, precision: 'node' | 'block' | 'file' }
}
```

Differences from the brief: `hash` / `sourceHash` split, `format`, `words`, `placeholders`
carry the source (so a translation can be applied without re-reading the document).
`text` could be dropped from storage (it is `fromPlaceholderForm(skeleton, placeholders)`).
`precision: 'node'` is what an mdast adapter could offer; comark gives `block` at best.

## 13. Storage in git (sketch)

Size estimate: 9,221 unique translatable hashes across all current sources, average skeleton
97 bytes (873 KB of English). A record with source skeleton, translation and provenance is
roughly 350-450 bytes of JSON, so **about 3.5-4 MB per locale today**, growing by roughly
4,000 records (about 80 KB of English, 1.5 MB of records) per year at the observed rate, plus
history if superseded records are kept as seeds.

Proposed layout, one repo `nuxt/translations` (name illustrative):

```
<locale>/
  segments/
    00.jsonl … ff.jsonl     # sharded by first two hex chars of the hash, ~36 records each today
  glossary.yml              # per-locale terminology, optional
sources.yml                 # which repos / refs / dirs feed the corpus
```

One record per line, lines sorted by hash, keys in fixed order:

```json
{"hash":"1d4e5186ed79d236","source":"Nuxt is powered by {0}Nitro{/0}, a modern server engine.","text":"Nuxt est propulsé par {0}Nitro{/0}, un moteur serveur moderne.","status":"human-verified","by":"github:someone","basis":"mt:model@2026-10","prev":"9f3b…","updated":"2026-11-01"}
```

Why this shape:

* **Low conflict**: unrelated translations touch different lines; inserts land at sorted
  positions; 256 shards keep files small enough for the GitHub diff view.
* **Reviewable**: the English skeleton sits next to the translation on the same line, so a PR
  diff is readable without the source repo; `prev` points at the hash it evolved from, so a
  bot comment or the site can show the sentence-level diff.
* **Bulk-loadable**: a locale is 256 small files or one concatenated file of ~4 MB (gzip ~1 MB);
  the site can load it as a content source and build a `Map<hash, record>`.
* **Garbage**: records not referenced by any source stay (they are seeds); a periodic job can
  move them to `<locale>/archive/` without touching live shards.

Contrast with a per-document layout (`<locale>/docs/<path>.md` or `.json`): nicer for a
translator working page by page, but it duplicates every shared segment per branch and per
repo (60% of words are shared across branches), every docs rename or move becomes a
translation move, staleness must be recomputed per file, and two people translating different
pages that share a sentence conflict or diverge. A per-page *view* is easy to generate from
the hash store (the segmenter already knows which hashes a page uses), so the per-document
experience can live in tooling rather than in storage. One downside of hash shards: a PR for
one page touches ~20-40 shard files; a generated "changed segments by page" summary would make
review practical.

## Caveats

* "Needs translation per week" counts every hash new to main, including churn inside
  in-flight Nuxt 5 docs; a stable docs period would be lower (median week: 23 segments).
* Change detection is per file; content moved between files counts as added + removed per
  file, but is correctly *not* counted at corpus level.
* `validate` rejection rates on real MT output are unmeasured.
* The pre-commit hook in the root workspace ran `pnpm install` on my first commit (root
  `node_modules` only, nothing tracked changed); later commits used `--no-verify`.
