# @diglot/store

The git record store of [diglot](../../README.md): translation records, source manifests, locale bundles, and loading of `diglot.config.ts` and `sources.yml`.

```bash
pnpm add @diglot/store @diglot/core
```

## Layout

```
diglot.config.ts
sources.yml                      repositories, refs and directories that feed the corpus
glossary.yml                     optional terminology shared by every locale (x18n shape)
<locale>/
  glossary.yml                   terminology for this locale
  style.yml                      style and typography rules
  locale.yml                     machine translation switch and review metrics
  segments/<hh>/<hash>.json      one record per locale and hash
.diglot/manifest/<source>.json   source segments per file, one entry per line
dist/<locale>.json               built bundle: { version, locale, records }
```

## Usage

```ts
import { build, createManifest, liveHashes, loadConfig, loadLocale, readManifests, readSource, writeManifest, writeRecord } from '@diglot/store'

const config = await loadConfig('.')
const snapshot = await readSource(config.sources[0], config.root)

await writeRecord(config.root, 'fr', record)
const records = await loadLocale(config.root, 'fr')

await build(config.root, { locales: config.locales, only: liveHashes(await readManifests(config.stateDir)) })
```

- Records are serialised with a fixed key order and a trailing newline, and validated on read and write.
- `readSource` reads a source at its `ref` through git, or from the working tree when no `ref` is set. `include` and `exclude` globs are relative to `dir` and default to markdown files and `.navigation.yml`.
- `build` returns, per locale, the bundle `path`, the number of `records` in it, how many of them a reviewer `rejected`, and how many were `skipped` because their hash is not live.
- `parseBundle` reads a built `dist/<locale>.json` into a `Map<hash, record>`. Bundles include rejected records, so consumers can show their status.
- `loadGlossary(root, locale, { shared })` reads the shared glossary (`config.glossary`) and `<locale>/glossary.yml`; locale entries replace shared entries with the same term. Both files accept diglot's shape (`terms` with a `decision` per entry) and [x18n](https://github.com/x18n-dev/x18n)'s `glossary` shape, so one file can serve both tools. See [`@diglot/mt`](../mt#glossary) for the mapping.
- `loadStyle(root, locale)` reads `<locale>/style.yml`: `rules`, `typography` and `lengthRatio`.
- `loadLocaleState(root, locale)` reads `<locale>/locale.yml`: `mt.enabled`, and `governance` metrics (`activeReviewers`, `approvalRate`, `reviewLatencyDays`, `updatedAt`) for a governance job to maintain. `mtEnabled(state)` is the switch the Action reads.
