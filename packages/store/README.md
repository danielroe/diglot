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
.diglot/policy.json              snapshot of the extraction policy
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
- `writePolicy(stateDir, policy)` writes `.diglot/policy.json`, `@diglot/core`'s `snapshotPolicy` of the configured policy, and `readPolicy(stateDir)` reads it. `diglot extract` and the Action write it next to the manifests, and set each manifest's `policy` to the policy's fingerprint.
- `build` returns, per locale, the bundle `path`, the number of `records` in it, how many of them a reviewer `rejected`, and how many were `skipped` because their hash is not live.
- `parseBundle` reads a built `dist/<locale>.json` into a `Map<hash, record>`. Bundles include rejected records, so consumers can show their status.
- `loadGlossary(root, locale, { shared })` reads the shared glossary (`config.glossary`) and `<locale>/glossary.yml`; locale entries replace shared entries with the same term. Both files accept diglot's shape (`terms` with a `decision` per entry) and [x18n](https://github.com/x18n-dev/x18n)'s `glossary` shape, so one file can serve both tools. See [`@diglot/mt`](../mt#glossary) for the mapping.
- `loadStyle(root, locale)` reads `<locale>/style.yml`: `rules`, `typography` and `lengthRatio`.
- `loadLocaleState(root, locale)` reads `<locale>/locale.yml`: `mt.enabled`, and `governance` metrics (`activeReviewers`, `approvalRate`, `reviewLatencyDays`, `updatedAt`) for a governance job to maintain. `mtEnabled(state)` is the switch the Action reads.
- `parseGlossary(data, locale, file)`, `mergeGlossary(shared, own)`, `parseLocaleState(data, file)` and `parseStyle(data, file)` are the parsers behind these loaders, for parsed YAML from anywhere. They are also exported from `@diglot/store/runtime`.

## Runtime

`@diglot/store/runtime` reads a store without a checkout or a file system, for servers that serve translations from the latest commit of a translations repository. It has no Node built-in imports.

```ts
import { readArchive } from '@diglot/store/runtime'

const response = await fetch(`https://codeload.github.com/nuxt/translations/tar.gz/${sha}`)
const archive = await readArchive(response.body!, { locales: ['fr'] })

const fr = archive.records.get('fr') // Map<hash, unknown>: read each with `parseRecord`
```

Extract and apply at runtime under the policy the manifests were extracted with, so hashes match:

```ts
import { restorePolicy } from '@diglot/core'

const policy = restorePolicy(archive.policy!) // throws when the policy has a custom `salt` or `codeLabel` that is not passed in
await apply(doc, translations, { policy })
```

- `readArchive(input, { locales, manifests })` reads a `tar` or `tar.gz` archive (a stream, `Uint8Array` or `ArrayBuffer`) as it arrives, keeping only records, the manifests in `.diglot/manifest`, the policy snapshot in `.diglot/policy.json` (as `policy`) and the YAML files at the root and in each locale directory. The top-level directory is dropped and `sha` comes from the pax header GitHub writes. Records and manifests that are not valid JSON, records whose `hash` does not match their file name, and manifests of another version are skipped and listed in `invalid`. It rejects when the archive is truncated or the stream errors.
- `manifestCoverage(manifest, records, { visible })` returns the words of each file of a manifest by `recordStatus`, and `fileCoverage(entries, records, { visible })` those of one file. `records` is a map or a lookup function by hash. Each record is validated against its manifest entry, so a text that fails validation counts as `rejected`; records `visible` returns `false` for count as `untranslated`. Segments without words are left out. Manifest helpers (`createManifest`, `serialiseManifest`, `validationTarget`, `liveHashes`) are exported here too.
- `changedRecords(before, after, fields)` returns the hashes whose record was added, removed or changed between two record sets (maps, or anything with `get` and `keys`), comparing `text`, `review`, `origin` and `derived` unless `fields` says otherwise. Use it to find the pages a push changed.
- `parseRecordFile(text, hash)` parses the text of a record file, returning `undefined` when there is none, it is not a valid record or its `hash` differs. `parseRecordPath(path)` is the inverse of `recordPath`: `{ locale, hash }` for `<locale>/segments/<hh>/<hash>.json`, `undefined` for any other path. Both, `recordPath` and `serialiseRecord` are also exported from the main entry.
- `archiveGlossary(archive, locale, { shared })`, `archiveLocaleState(archive, locale)` and `archiveStyle(archive, locale)` read a locale's merged glossary, `locale.yml` and `style.yml` from `archive.files`, as the loaders above read them from disk. `shared` defaults to `glossary.yml`; pass `false` for none. They throw on malformed files.
- `encodeRecords(records, { compression })` serialises a locale's records (a `Map` or object keyed by hash) into one string for a key-value cache: packed into columns with repeated values interned, then compressed and base64-encoded. `compression` is `gzip` (the default, readable everywhere), `zstd` (about three times faster to write and twice as fast to read, but only where `node:zlib` has zstd) or `none`. Values that fail `parseRecord` or sit under another hash are left out. `decodeRecords(data)` reads it back into a `Map<hash, record>`.
- `decodeRecordsView(data)` reads the same string into a `ReadonlyMap<hash, record>` that builds each record the first time it is read and returns that object afterwards, for servers that decode a locale's records on each cold start but read only some of them. The pack's structure is checked up front; reading a malformed record throws. Iterating the view builds every record.
- Where `process.getBuiltinModule` exists (Node, Deno, Bun), both use `node:zlib`; elsewhere `CompressionStream` and `DecompressionStream`.
