# @diglot/cli

The `diglot` command for [diglot](../../README.md) translations repositories.

```bash
pnpm dlx @diglot/cli <command>
```

Every command reads `diglot.config.ts` and `sources.yml` from `--cwd` (default `.`).

| Command | Description |
| --- | --- |
| `diglot checkout [sources...]` | Export each source (default all) as plain files under `.diglot/sources/<source>` at its configured ref |
| `diglot extract [--source name]` | Extract the segments of each source and write `.diglot/manifest/<source>.json` |
| `diglot diff [--source name] [--json]` | Compare each source with its manifest: added, removed and modified segments per file, with the predecessor of each modified segment and the number of changed sentences |
| `diglot validate [--locale fr] [--json]` | Check every record: shape, path, hash against its source skeleton, and the translation against each use of the segment. Exits with code 1 on errors |
| `diglot build [--locale fr] [--all]` | Write `dist/<locale>.json` with the records used by any source (`--all` includes unused ones) |
| `diglot status [--locale fr] [--json]` | Segments and words per locale and source by status, and the share of words that are edited or verified |
