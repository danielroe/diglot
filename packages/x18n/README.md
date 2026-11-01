# @diglot/x18n

> [!WARNING]
> Experimental. Built against x18n 0.1.5.

An [x18n](https://github.com/x18n-dev/x18n) plugin for [diglot](../../README.md) translations repositories. It shows a diglot store in x18n's CLI, editor and browser UI: each segment hash is a key, the source manifests hold the source-locale messages, each record file holds one translation, and every place a segment occurs in a source document is a usage of its hash.

```bash
pnpm add -D @diglot/x18n @x18n/cli
```

```ts
// x18n.config.ts, next to diglot.config.ts
import diglot from '@diglot/x18n'

export default {
  plugins: [diglot()],
}
```

Usages come from the working tree: a source needs a local `path` inside the translations repository that git does not ignore, and only the checked-out ref is scanned. With the layout of [`examples/nuxt`](../../examples/nuxt) (git-ignored checkouts under `.diglot/checkouts`, several refs of one checkout) x18n 0.1.5 finds no usages; everything else works.

## What it adds

- Formats `diglot-manifest` (read-only, `.diglot/manifest/<source>.json`) and `diglot-record` (`<locale>/segments/<hh>/<hash>.json`). Editing a translation through x18n rewrites its record: the text changes, `review` becomes `edited`, a verification is dropped and `updatedAt` is set. Fields the record schema does not know are kept.
- A `diglot-markdown` scanner over the markdown and `.navigation.yml` files of each source, so find references and the UI's usage list point at the paragraph of each segment.
- A `diglot` placeholder syntax for skeletons (`{n}`, `{n}...{/n}`), used by `placeholder-mismatch`, `invalid-syntax` and the UI.
- Checks `diglot-validate` (diglot's `validate` against every kind of unit a hash is used as), `diglot-review` (unreviewed machine translations; machine updates of earlier translations are warnings) and `diglot-unused` (records whose hash no manifest uses).
- A `diglot` history provider that reads record metadata instead of git. A record carried or updated from a predecessor and not yet reviewed is a stale translation, and its previous source and text are available to the UI and to `x18n prompt translate --stale`.
- The rules of the skeleton grammar, `<locale>/style.yml` rules and glossary style rules in translate prompts, and each locale's glossary (the shared `glossary` of `diglot.config.ts` merged with `<locale>/glossary.yml`, read by `@diglot/store` as `@diglot/mt` reads it) as x18n glossary entries.
- `missing-translation` is off by default, since `x18n status` and the UI show coverage. `unused-key` is off in favour of `diglot-unused`, because a hash is live when a manifest lists it, whether or not its document is checked out. With more than one source, `key-conflict` is off too: a hash shared by two sources is defined in two manifests.

`applyReviews(root, reviews)` verifies the records whose current text an x18n `approve` review approved. Change requests and suggestions stay x18n review threads.

## Limitations

- New translations cannot be created through x18n 0.1.5: x18n places a new key in an existing resource of the locale, and a record file holds one hash. The plugin's locale finder implements a proposed `resolveKey` hook for this; x18n ignores it today.
- Record edits made through x18n have no author, so `by` is not set.
- Keys are hashes, so the keys grid sorts by hash rather than by document.
