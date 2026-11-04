# @diglot/x18n

> [!WARNING]
> Experimental. Built against x18n 0.1.10.

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

Usages come from the files under `.diglot/sources/<source>`, which `diglot checkout` exports as plain files at each source's configured ref. The plugin sets `usage.include` to those documents and `usage.gitignore` to `false`, so the git-ignored exports in [`examples/nuxt`](../../examples/nuxt) are scanned.

## What it adds

- Formats `diglot-manifest` (read-only, `.diglot/manifest/<source>.json`) and `diglot-record` (`<locale>/segments/<hh>/<hash>.json`). Editing a translation through x18n rewrites its record: the text changes, `review` becomes `edited`, a verification or rejection is dropped and `updatedAt` is set. Fields the record schema does not know are kept. Translating a hash that has no record in a locale creates its record file, as a human edit.
- A translation state per record, from diglot's `recordStatus`: unreviewed machine translations, machine updates, rejected records and translations that fail validation `needs-review`, human edits `translated`, verified records `reviewed`. `x18n status` and the UI count them.
- A label per hash: the file of the segment and the last heading above it, such as `guide.md > Introduction`. The keys grid shows and sorts by it, and `x18n get` and `x18n keys` print it.
- A `diglot-markdown` scanner over the markdown and `.navigation.yml` files of each source, so find references and the UI's usage list point at the paragraph of each segment.
- A `diglot` placeholder syntax for skeletons (`{n}`, `{n}...{/n}`), used by `placeholder-mismatch`, `invalid-syntax` and the UI.
- Checks `diglot-validate` (diglot's `validate` against every kind of unit a hash is used as), `diglot-review` (unreviewed machine translations; machine updates of earlier translations are warnings) and `diglot-unused` (records whose hash no manifest uses).
- A `diglot` history provider that reads record metadata, with x18n's git history turned off. A record carried or updated from a predecessor and not yet reviewed is a stale translation, and its previous source and text are available to the UI and to `x18n prompt translate --stale`.
- The rules of the skeleton grammar, `<locale>/style.yml` rules and glossary style rules in translate prompts, and each locale's glossary (the shared `glossary` of `diglot.config.ts` merged with `<locale>/glossary.yml`) as x18n glossary entries.
- `missing-translation` and `unused-key` are off by default: `x18n status` and the UI show coverage, and `diglot-unused` reports records no manifest lists. With more than one source, `key-conflict` is off too, as a hash shared by two sources is defined in two manifests.

## Reviews

Approving a translation in x18n (`x18n review approve <hash> --locale fr`, or the UI) verifies its record: the record becomes `review: 'verified'` with `verifiedBy` set to the reviewer and the time of the approval, and the approval is added to `.x18n/reviews.yml` in the same edit plan. Commit both files together.

Records are verified with `@diglot/core`'s `verifyRecord`, and only while they still hold the approved text. Rejected records are left for an edit to replace, records that fail validation are not verified, and verified records keep their first reviewer.

Applying a suggestion is an edit of the record, so it becomes `edited`. Comments, change requests and resolving a thread leave the record as it is.

`verifiedBy.by` is the login of the approval author's GitHub noreply email. Failing that, when the author is unset or is the project's git identity, it is the `GITHUB_ACTOR` environment variable, then `gh api user --jq .login`. Otherwise it is the author's name, then their email.

## Limitations

- Record edits made through x18n have no author, so `by` is not set.
