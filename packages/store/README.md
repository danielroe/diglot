# @diglot/store

The git record store of [diglot](../../README.md): translation records, source manifests, locale bundles, and loading of `diglot.config.ts` and `sources.yml`.

```bash
pnpm add @diglot/store @diglot/core
```

## Layout

```
diglot.config.ts
sources.yml                      repositories, refs and directories that feed the corpus
<locale>/
  glossary.yml                   terminology and style rules
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
- `parseBundle` reads a built `dist/<locale>.json` into a `Map<hash, record>`.
- `loadGlossary(root, locale)` reads `<locale>/glossary.yml`.
