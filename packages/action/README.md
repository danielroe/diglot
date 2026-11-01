# @diglot/action

A GitHub Action for [diglot](../../README.md) translations repositories. On each run it extracts every source, diffs it against the stored manifests, machine-translates what changed for each locale with machine translation enabled, rebuilds `dist/<locale>.json`, and commits the result as one commit.

```yaml
- uses: actions/checkout@v4
- id: diglot
  uses: danielroe/diglot/packages/action@main
  with:
    git-user-name: translations-bot
    git-user-email: translations-bot@users.noreply.github.com
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
- if: steps.diglot.outputs.committed == 'true'
  run: git push
```

The Action commits to the checked-out branch and never pushes; pushing is the workflow's step, so the job needs `contents: write` and no other token. See [`examples/nuxt`](../../examples/nuxt) for a complete translations repository and workflow.

## What a run does

1. Loads `diglot.config.ts` and `sources.yml`. Sources with a `repo` and a `ref` whose `path` does not exist (default `.diglot/checkouts/<repo>`) are fetched shallowly into a bare repository; existing working copies are read as they are.
2. Extracts the segments of each source at its `ref` and diffs them file by file against `.diglot/manifest/<source>.json`. Modified segments are paired with their predecessor; the pairing is kept in `.diglot/lineage.json` so a later run can still find it.
3. For each locale whose `<locale>/locale.yml` has `mt.enabled: true`, every live segment without a record is handled once (identical text across sources and branches shares one record):
   - with a predecessor that has a record: `updateTranslation` from `@diglot/mt`, which carries the text over without a model call when the skeleton is identical and only the hash changed (a context salt, `derived: carry`), and otherwise updates it from the word diff (`derived: update`), case and punctuation edits included;
   - without one: `translateSegments`, one request per page, with the locale's glossary and style.
4. Writes records with `review: none` and `prev` where there is a predecessor (`origin: mt`, except carries, which keep the predecessor's `origin` and `mt`; carried and updated records read as `pending-review`), updates manifests, and builds `dist/<locale>.json` from the live records of every locale.
5. Commits the changed records, state and bundles as the given identity with a summary message, for example `chore(fr): translate 78 segments, update 12, carry 31`.

Segments rejected by QA are listed in `.diglot/rejected/<locale>.json` with the reasons and skipped by later runs until their source changes (or `retry-rejected` is set). Locales with machine translation disabled get no new records, but their bundles are still rebuilt. A run with no source changes makes no model calls and no commit.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `working-directory` | `.` | Root of the translations repository |
| `locales` | all | Only these locales (comma or space separated) |
| `sources` | all | Only these sources |
| `model` | `mt.model`, then `DIGLOT_MT_MODEL` | Model id for the Vercel AI Gateway |
| `ai-gateway-api-key` | `AI_GATEWAY_API_KEY` | Gateway key |
| `limit` | none | Most segments per locale sent to the model in one run; the rest wait for the next run |
| `retry-rejected` | `false` | Translate previously rejected segments again |
| `commit` | `true` | Commit the changes |
| `git-user-name` | `diglot[bot]` | Commit author |
| `git-user-email` | `diglot[bot]@users.noreply.github.com` | Commit author email |

## Outputs

| Output | Description |
| --- | --- |
| `translated` | Segments translated from scratch |
| `updated` | Translations updated from their predecessor |
| `carried` | Translations carried over from their predecessor |
| `rejected` | Segments rejected by QA |
| `costUsd` | Model cost in USD, when the provider reports it |
| `committed` | `true` when a commit was made |
| `sha` | The new commit |

The job summary has a table per locale and source, and the rejected segments with their QA issues.

## As a library

```ts
import { run, summary } from '@diglot/action'

const result = await run({ cwd: '.', locales: ['fr'], limit: 200, commit: false })
console.log(summary(result))
```
