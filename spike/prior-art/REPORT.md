# Prior-art survey: segment-level, human-first docs localisation

Scope: reading only. Everything below links to the file or page I actually read. Where I infer behaviour that I did not see in code or docs, I say so.

Constraints from the parent that shape the conclusions:

- Git is the source of truth for translations, in a separate repo of segment records, so other projects can self-host it.
- The translation grammar is restricted to text, emphasis and numbered placeholders.

## How the research was done (and what was unreachable)

GitHub content came through `gh` and `raw.githubusercontent.com`. GitLab (`gitlab.com`) and `developers.google.com`, `docs.github.com`, `learn.microsoft.com` and `mozilla-l10n.github.io` were reachable with `curl`. The following hosts are blocked by the sandbox allowlist, so for them I read the docs source from GitHub instead, or noted the gap:

`gnu.org`, `docs.oasis-open.org`, `w3.org`, `tc39.es`, `docs.weblate.org`, `support.crowdin.com`, `lunaria.dev`, `lingo.dev`, `inlang.com`, `lingui.dev`, `po4a.org`, `sphinx-doc.org`, `docs.translatehouse.org`, `sourceforge.net` / `omegat.sourceforge.io`, `okapiframework.org`, `kubernetes.io`, `messageformat.unicode.org`, `i18n.nuxtjs.org`, `docs.transifex.com`, `docs.lokalise.com`, `docs.gitlocalize.com`, `pontoon.mozilla.org`, `developer.mozilla.org`, `vuejs.org`, `react.dev`, `docs.astro.build`, `contribute.docs.astro.build`, `mediawiki.org`, `web.archive.org`, `crates.io` (403).

Lokalise has no public docs source on GitHub that I could find, so it is not covered. GitLocalize is covered only from observed bot PRs.

## 1. Comparison table

Abbreviations: MT = machine translation, TM = translation memory.

| Item | Unit | Identity | Staleness detection | State model | Storage | Review flow | MT integration |
|---|---|---|---|---|---|---|---|
| gettext PO | message (any string) | `msgctxt` + `msgid` (source text is the key) | `msgmerge` against new POT: exact match keeps, fuzzy match marks `#, fuzzy` and keeps `#\| msgid` | untranslated / fuzzy / translated / obsolete (`#~`) | `.po` per locale | translator clears fuzzy flag in an editor | none built in |
| XLIFF 2.x | `<segment>` inside `<unit>` | `unit@id` (required), `segment@id` (optional) | not specified; change-tracking module records revisions | `initial` -> `translated` -> `reviewed` -> `final`, plus free `subState` (`prefix:value`) | XML file | not prescribed | Candidates module: `<match type="mt\|tm\|...">` with `similarity`, `matchQuality`, `origin`; ITS `mtConfidence`, provenance |
| Unicode MessageFormat 2 | message | key from the surrounding resource format | n/a | n/a | n/a (resource format still draft) | n/a | n/a |
| OmegaT / Okapi TM | sentence (SRX) | source text | n/a (lookup by similarity) | TMX has no workflow state; per-TU `changeid` / `changedate` | TMX | n/a | MT is a separate pane |
| mdbook-i18n-helpers | paragraph, list item, heading, table cell, code-block strings | normalised markdown of the block as `msgid` | `msgmerge` | gettext; fuzzy entries are **not rendered** | `po/xx.po` in the book repo | PRs on PO files, GitHub suggestions | optional `cloud-translate`; all MT output is fuzzy |
| po4a | paragraph | `msgid` + `#:` ref | `msgmerge` | gettext | PO | PO editor | none |
| Sphinx gettext + sphinx-intl | doctree node (paragraph, list item) | `msgid`; optional UUID per msgid | `msgmerge`; `gettext_uuid` adds similarity to old msgids | gettext; `gettext_allow_fuzzy_translations` | PO / MO | PO editor or Transifex | none |
| translate-toolkit md2po | paragraph | `msgid` (dupes via `msgctxt` by default) | `pot2po` / merge | gettext | PO | PO editor / Weblate | none |
| Lunaria | file (or dictionary key) | file path pattern `@lang/@path` | git: latest "major" commit date source vs locale | missing / outdated / done | git history only | GitHub PRs; dashboard | none |
| lingo.dev | positional section / key | path pattern + positional key (`md-section-N`) | MD5 of source value per key in `i18n.lock`; new CLI: sha256 per file | none (translated or not) | lockfile + translated files in repo | PR from CI / GitHub App | the product: LLM translates the delta |
| Crowdin | string or SRX sentence | key for key/value files; for markdown, segment (inferred) | source file update shows changed strings; manager chooses which translations to keep | translated / approved; tracks auto-generated vs human | Crowdin DB, exported files | proofreader approval, voting | AI / MT / TM auto-translate with "keep human translations" |
| Weblate | string; markdown paragraph via translate-toolkit | key or source + location | source change -> "Needs rewriting"; fuzzy -> "Needs editing" | untranslated / needs editing / needs rewriting / translated (waiting for review) / approved / read-only, plus suggestions | files in git where format allows, DB otherwise | suggestions, voting, reviewer approval | add as translation / as "needing edit" / as suggestion |
| Transifex Native | string | hash of source string + context | new hash = new string | n/a in SDK | CDS service | in TMS | in TMS |
| GitLocalize | file (markdown) | file path | not observed | not observed | translated markdown in repo | review on GitLocalize, then bot PR | not observed |
| Pontoon | entity (string) | resource + key | VCS sync | missing / pretranslated / unreviewed / translated (approved), plus fuzzy for PO | Pontoon DB, synced to VCS | approve / reject, filters | **pretranslation**: TM 100% match else custom MT model; distinct status |
| inlang / Paraglide | message (bundle -> message -> variant) | bundle id (recommends random human-readable keys) | `inlang check` for missing translations / variables | none in data model (inferred) | `.inlang` (Lix) packed, or plugin files like `messages/{locale}.json` | Fink editor; Lix change proposals | not core |
| Lingui | message | 6-char sha256 of source + context (or explicit) | re-extraction | PO flags if PO format | PO / JSON catalogs | external | external |
| MDN | file | path; `l10n.sourceCommit` frontmatter | compare `sourceCommit` with upstream history | none per file | per-locale content repo | PRs, locale peers | German locale is fully LLM-translated daily |
| Vue docs | file | path | Ryu-Cho opens an issue/PR per upstream commit | none | separate repo per language | PRs | n/a; core docs no longer accept new translations |
| react.dev | file | path in a fork | weekly bot merge; conflict list in PR body | none | fork per language | PRs, 1 to 2 reviewers | none |
| Astro docs | file / dictionary key | path; `i18nReady` frontmatter | Lunaria | missing / outdated / done | in-repo `src/content/docs/<lang>` | PR review by language crews | explicitly refused |
| Kubernetes | file | path in `content/<lang>` | Hugo `Lastmod` comparison; `lsync.sh`; heuristic triage script | none | in-repo | OWNERS per language | allowed with "extensive human review" |
| GitHub Docs | file | path | not public | not public | separate translations repos | not public | MT/AI disclosed by banner |
| Wikipedia Content Translation | paragraph / section | section id | n/a (one-time translation) | per-section "unmodified MT %" | MediaWiki | tracking category for review | MT inline; publish blocked above thresholds |

## 2. Per-item lessons

### Formats and engines

**gettext PO** ([`gettext.texi`](https://github.com/autotools-mirror/gettext/blob/master/gettext-tools/doc/gettext.texi), [`msgmerge.texi`](https://github.com/autotools-mirror/gettext/blob/master/gettext-tools/doc/msgmerge.texi), [`message.h`](https://github.com/autotools-mirror/gettext/blob/master/gettext-tools/src/message.h), [`message.c`](https://github.com/autotools-mirror/gettext/blob/master/gettext-tools/src/message.c), [`msgl-fsearch.c`](https://github.com/autotools-mirror/gettext/blob/master/gettext-tools/src/msgl-fsearch.c), [gnulib `fstrcmp.h`](https://github.com/coreutils/gnulib/blob/master/lib/fstrcmp.h); GitHub mirrors, since `gnu.org` is blocked)

- The source text *is* the key (`msgctxt` + `msgid`). This gives dedup and branch independence for free, which is exactly what multi-source docs need.
- `#| msgid` (written by `msgmerge --previous`) keeps the old source next to a fuzzy entry, so a translator sees what changed. The manual's colouring section calls out this diff as the main point. Steal this: store `previousSource` on every stale record.
- Fuzzy matching: `FUZZY_THRESHOLD` is `0.6` on `fstrcmp`, a character-level similarity in `[0, 1]`. Candidates are pre-filtered with a 4-gram index (`msgl-fsearch.c`). A same-context match gets a tiny `0.00001` bonus, otherwise context is ignored.
- Failure modes that follow from that code: the match is global across the whole catalogue, so a new paragraph can inherit a translation from an unrelated page that shares boilerplate; character-level similarity on short strings is noisy; and one `msgid` occurring in two places collapses to one entry unless someone adds `msgctxt`. (The last two are my reading of the algorithm, not documented warnings.)
- Fuzzy is a single bit that conflates "machine guessed this" with "source changed under a human translation". Pontoon later had to split it (see below).

**XLIFF 2.x** (spec sources in [`oasis-tcs/xliff-xliff-22`](https://github.com/oasis-tcs/xliff-xliff-22): [`state.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-22/attributes/state.xml), [`subState.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-22/attributes/subState.xml), [`pc.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-22/elements/inline/pc.xml), [`ph.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-22/elements/inline/ph.xml), [`candidates_type.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-22/attributes/candidates/candidates_type.xml), [`candidates_origin.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-22/attributes/candidates/candidates_origin.xml), [`itsm_mtConfidence.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-21/attributes/itsm/itsm_mtConfidence.xml), [`itsm_revPerson.xml`](https://github.com/oasis-tcs/xliff-xliff-22/blob/master/xliff-21/attributes/itsm/itsm_revPerson.xml))

- Four states form "a simple linear state machine": `initial`, `translated`, `reviewed`, `final`. `subState` is `prefix:value`, user-defined, and writers that change `state` must update or delete `subState`. That is a ready-made slot for provenance (`nuxt:mt`, `nuxt:human-edited`) without inventing new states.
- Inline codes: `<ph>` is a standalone code (always empty, required `id`); `<pc>` wraps a span with translatable content inside. `canDelete`, `canCopy`, `canReorder` hints exist. This maps cleanly onto "inline code / component = `<ph>`, link or emphasis = `<pc>`".
- MT and TM output belongs in `<mtc:matches>` candidates with `type="mt"`, `similarity` (0 to 100), `matchQuality`, `origin`, not in the target. Keeping candidates separate from the accepted translation is the cleanest provenance model I found.
- ITS provenance (`person`, `org`, `tool`, `revPerson`, `revOrg`, `revTool`) can attach "who translated" and "who reviewed" to any element. This is the closest standard precedent for a per-segment "verified by".
- Lesson: we do not need to store XLIFF, but our record shape should round-trip to it, so projects can export to Okapi/OmegaT/Weblate if they want.

**TMX** (observed in a real OmegaT team project: [`LibreOffice/OmegaT` `project_save.tmx`](https://github.com/LibreOffice/OmegaT/blob/master/cs/LOGuides/omegat/project_save.tmx); TMX spec host blocked)

- A `<tu>` has one `<tuv>` per language; each `<tuv>` carries `creationid`/`changeid` and dates. There is no workflow state.
- Entries are keyed by source text, which is what makes TM reusable across files and projects.
- That repo is itself a git-backed TM: OmegaT team projects sync `project_save.tmx` through git. See section 3.

**Unicode MessageFormat 2** ([WG README](https://github.com/unicode-org/message-format-wg/blob/main/README.md), [`spec/syntax.md` Markup](https://github.com/unicode-org/message-format-wg/blob/main/spec/syntax.md), [`messageformat` README](https://github.com/messageformat/messageformat/blob/main/mf2/messageformat/README.md), [`@messageformat/resource` README](https://github.com/messageformat/messageformat/blob/main/mf2/resource/README.md), [TC39 proposal README](https://github.com/tc39/proposal-intl-messageformat/blob/main/README.md))

- MF2 is a stable part of CLDR (TR35); some default functions are still Draft. `Intl.MessageFormat` is still TC39 Stage 1.
- MF2 markup (`{#b}...{/b}`, `{#x/}`) is the same open/close/standalone shape as XLIFF `<pc>`/`<ph>`. If the UI-string layer adopts MF2, the docs segment grammar can reuse its markup syntax for placeholders.
- The resource file format (the thing that would hold keys and metadata) is still a W3C incubation with "breaking changes between 0.x" releases. Do not bet the store format on it yet.

**OmegaT / Okapi fuzzy matching** (OmegaT [`FindMatches.java`](https://github.com/iADAATPA/omegat/blob/master/src/org/omegat/core/statistics/FindMatches.java) and [`FuzzyMatcher.java`](https://github.com/iADAATPA/omegat/blob/master/src/org/omegat/core/matching/FuzzyMatcher.java) from a GitHub fork, since upstream is on SourceForge; Okapi [`scorer/Util.java`](https://gitlab.com/okapiframework/Okapi/-/blob/main/okapi/libraries/lib-search/src/main/java/net/sf/okapi/lib/search/lucene/scorer/Util.java))

- OmegaT scores three ways: stemmed word tokens, unstemmed word tokens, and tokens including numbers and tags. Each is `100 * (max(len) - levenshtein) / max(len)` on token arrays.
- OmegaT subtracts 40 for matches that come from fuzzy entries (citing gettext's 60% threshold) and 5 when something was removed, so a fuzzy-derived match never looks like a clean one.
- Okapi uses Dice's coefficient over character trigrams (`2 * |A ∩ B| / (|A| + |B|)`), indexed with Lucene.
- Lesson: score on tokens after placeholder substitution, so a changed URL or code span does not drag the score down, and keep separate "text similarity" and "placeholder similarity" numbers.

### Markdown docs tooling

**google/mdbook-i18n-helpers** ([`USAGE.md`](https://github.com/google/mdbook-i18n-helpers/blob/main/i18n-helpers/USAGE.md), [`src/lib.rs`](https://github.com/google/mdbook-i18n-helpers/blob/main/i18n-helpers/src/lib.rs), [`src/normalize.rs`](https://github.com/google/mdbook-i18n-helpers/blob/main/i18n-helpers/src/normalize.rs), [`src/xgettext.rs`](https://github.com/google/mdbook-i18n-helpers/blob/main/i18n-helpers/src/xgettext.rs))

- Segmentation works on pulldown-cmark events: `group_events` splits them into `Translate` and `Skip` groups. Headings, list items and table cells become separate messages; structural markup is stripped from the `msgid` (`"- foo"` becomes `"foo"`).
- Inline markup stays *in* the `msgid` as re-serialised markdown, normalised to `_emphasis_` and `**strong**`. There is no placeholder tokenisation: link URLs and inline code are editable by translators.
- Code blocks: if the fence has a language, syntect extracts only string literals and comments; without one, a heuristic (contains `"` or `//`) decides. `<!-- i18n:skip -->`, `skip-start`/`skip-end` and `<!-- i18n:comment: -->` give authors control.
- Rendering ignores fuzzy entries (`!msg.flags().is_fuzzy()`), so stale or MT text silently falls back to English mid-page with no marker.
- `mdbook-i18n-normalize` exists because a segmentation change in the tool would otherwise orphan every translation. It re-extracts both `msgid` and `msgstr`, zips them, and marks the result fuzzy when the counts differ. **Lesson: the segmenter is part of the identity function. Version it, and ship a migration when it changes.**
- `#:` source references carry line numbers; `granularity` rounds them "to reduce number of updates to your PO files". That is a symptom of putting volatile locators in the record.

**Comprehensive Rust in production** ([`TRANSLATIONS.md`](https://github.com/google/comprehensive-rust/blob/main/TRANSLATIONS.md))

- When building a translation, `build.sh` runs `git restore --source $LAST_COMMIT src/` to the commit at the PO's `POT-Creation-Date`. Translations therefore never degrade into mixed language, but they also never receive English fixes. This is a deliberate trade-off worth naming: consistency over freshness.
- Reviewers are listed in CODEOWNERS; review uses GitHub suggestions. Guidance: merge reasonable work and iterate, because "translations are a labour of love".
- PRs must be either `msgmerge` output or translation work, never both, because mixing them creates an unreviewable diff.
- Two status reports: as checked in, and after syncing with `msgmerge`. The second one is the honest one.

**po4a** ([`po4a.7.pod`](https://github.com/mquinson/po4a/blob/master/doc/po4a.7.pod), [`po4a` `--keep`](https://github.com/mquinson/po4a/blob/master/po4a), [`CommonMark.pm`](https://github.com/mquinson/po4a/blob/master/lib/Locale/Po4a/CommonMark.pm))

- A document is written only if at least 80% is translated (`--keep`). The docs state the tension plainly: 100% discourages translators, too little confuses readers. That is the same question nuxt.com faces at page level.
- Unchanged paragraphs reuse translations, slightly changed ones go fuzzy, heavily changed ones are left untranslated.
- "Addenda" let translators add locale-only content at anchored positions. This could be worth having (translator credits, locale notes), but it is out of scope for v1.
- The CommonMark module is marked "early stage"; markdown support has historically been the weak spot of PO-based tools.

**Sphinx gettext + sphinx-intl** ([`intl.rst`](https://github.com/sphinx-doc/sphinx/blob/master/doc/usage/advanced/intl.rst), [`configuration.rst`](https://github.com/sphinx-doc/sphinx/blob/master/doc/usage/configuration.rst))

- "Every single element in the doctree will end up in a single message"; splitting long paragraphs is left to authors because "there is no sane automated way". This argues for paragraph-level units with optional sentence-level splitting.
- Sphinx warns when cross-references in the translated paragraph do not match the original (`#noqa` opts out). That is a placeholder-integrity check at build time.
- `translation_progress_classes` adds `translated`/`untranslated` classes to every translatable node in the HTML output. **This is the closest precedent I found for per-segment status visible in the rendered page**, though the docs frame it as a tool for translators, not readers.
- `gettext_uuid` adds a UUID per msgid and "calculates similarity between new msgids and previously saved old msgids", optionally with `Levenshtein`. Sphinx needed a stable id alongside content identity in order to link versions.

**translate-toolkit md2po / po2md** ([`storage/markdown.py`](https://github.com/translate/translate/blob/master/translate/storage/markdown.py), [`md2po.rst`](https://github.com/translate/translate/blob/master/docs/commands/md2po.rst), [`test_markdown.py`](https://github.com/translate/translate/blob/master/tests/translate/storage/test_markdown.py))

- Principles in the module docstring: one unit per paragraph; keep formatting out of units "as much as possible"; keep emphasis and inline code inline; use `{1}`, `{2}` placeholders otherwise.
- Links become `[link text]{1}`: the text stays translatable and the URL is hidden behind a number. That is `<pc>` semantics in a plain-text grammar, and it is very close to the grammar the parent has chosen. Raw HTML open/close tags become separate numbered placeholders (`now {1}hear ye{2} all`), which is `<sc>`/`<ec>` semantics.
- Duplicate strings default to `msgctxt` disambiguation (`--duplicates=msgctxt`) rather than merging.
- `po2md --threshold` and `--fuzzy`/`--nofuzzy` repeat the po4a threshold and the mdbook fuzzy policy.
- Weblate's markdown support is built on this module, so it is the most widely deployed markdown placeholder model in open source.

**Lunaria** ([`guides/tracking.mdx`](https://github.com/lunariajs/lunaria/blob/main/docs/src/content/docs/guides/tracking.mdx), [`reference/configuration.mdx`](https://github.com/lunariajs/lunaria/blob/main/docs/src/content/docs/reference/configuration.mdx), [`recommendations.mdx`](https://github.com/lunariajs/lunaria/blob/main/docs/src/content/docs/recommendations.mdx); npmx [`lunaria.config.ts`](https://github.com/npmx-dev/npmx.dev/blob/main/lunaria.config.ts), [`useI18nStatus.ts`](https://github.com/npmx-dev/npmx.dev/blob/main/app/composables/useI18nStatus.ts))

- Status comes from comparing the latest "major" commit date of the source file with that of the localised file. It needs full git history (no shallow clones).
- `tracking.ignoredKeywords` (default `lunaria-ignore`, `fix typo`) in a commit title stops a commit from marking translations outdated. `@lunaria-track:` / `@lunaria-ignore:` directives in commit bodies do the same per file. Lunaria recommends squash merges so this is predictable.
- `dictionary` type files are checked for key completion, not freshness; `optionalKeys` exempts keys.
- Why file-level is not enough for nuxt.com: one changed sentence marks a whole page outdated without saying which sentence; "done" means "touched after", not "matches"; dates only exist inside one repo, and our sources span several repos and branches; and a human has to choose `fix typo` correctly at commit time. The "this change should not invalidate translations" escape hatch is worth keeping, but at segment level and decided by a maintainer after the fact.
- npmx consumes Lunaria's `status.json` at runtime to show locale progress in the UI. That is a nice pattern; our store can emit the same kind of status file.

**lingodotdev/lingo.dev** ([`utils/lockfile.ts`](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/src/cli/utils/lockfile.ts), [`packages/cli/i18n.lock`](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/i18n.lock), [`loaders/markdown.ts`](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/src/cli/loaders/markdown.ts), [`loaders/mdx2/code-placeholder.ts`](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/src/cli/loaders/mdx2/code-placeholder.ts), [`markdown-docs-localization-example`](https://github.com/lingodotdev/markdown-docs-localization-example), [CLI README](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/README.md))

- `i18n.lock` (v1 CLI) is YAML: `checksums[MD5(pathPattern)][key] = MD5(sourceValue)`. `extractUpdatedData` sends only keys whose checksum changed. That makes "translate only the delta" trivial, and is the core of the idea worth keeping.
- But the keys are positional (`md-section-3`, `mjml/mj-body/0/mj-section/1/...`). Inserting a section at the top changes every later key, so the delta becomes "everything after the insert". I infer this from the key scheme; I did not run it.
- The markdown loader splits on a regex (`SECTION_REGEX` matches headings, rules, standalone links/images), not an AST. The MDX path replaces fenced and inline code with `CODE_PLACEHOLDER_<md5>_END`, but links and components are left to the model.
- The newer `@lingo.dev/cli` keeps only `sha256` per *file* in `.lingo/lock.json` and writes whole translated files to `docs/<locale>/`. As far as I can tell from the example repo, a source change re-translates the delta into the target file, so human edits in the target file have no protected status.
- There is no reviewed/unreviewed state anywhere in the lockfile. MT is the product, and humans are positioned as proofreaders inside the hosted platform.

### Platforms

**Crowdin** ([`auto-translation.mdx`](https://github.com/crowdin/docs/blob/main/src/content/docs/crowdin/translation-process/auto-translation.mdx), [`translation-memory.mdx`](https://github.com/crowdin/docs/blob/main/src/content/docs/crowdin/localization-resources/translation-memory.mdx), [`file-management.mdx`](https://github.com/crowdin/docs/blob/main/src/content/docs/crowdin/project-management/sources/file-management.mdx), [`custom-segmentation.mdx`](https://github.com/crowdin/docs/blob/main/src/content/docs/crowdin/project-management/sources/custom-segmentation.mdx), [`in-context.mdx`](https://github.com/crowdin/docs/blob/main/src/content/docs/developer/capabilities/in-context.mdx))

- Auto-translate has an option to "Replace auto-generated translations (Keep human translations)", plus "Skip approved strings" and "Reset approval status so proofreaders can re-review". So Crowdin tracks the origin of each translation separately from its approval. That is the provenance/state split we want.
- When a source file is updated, a "Keep Translations for Updated Strings" dialog shows old and new source with a diff. The manager ticks which translations survive, optionally with approvals. This is the segment-level equivalent of Lunaria's `fix typo`, and it is decided by a human looking at a diff.
- TM match tiers: "Perfect" (text and context match), "100%" (text only), fuzzy. Tags are ignored for matching (`Hello <b>world</b>!` = `Hello <a>world</a>!`), and "auto-substitution" swaps in the new placeholders.
- Markdown and HTML without keys are segmented with SRX 2.0 rules, customisable per file. That is sentence-level by default.
- In-Context: a pseudo-language whose strings are identifiers; a JS snippet turns them into editable labels on the live app. This is the main precedent for "edit from the rendered page", aimed at translators rather than readers.

**Weblate** ([`workflows.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/workflows.rst), [`formats/markdown.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/formats/markdown.rst), [`markdown-features.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/snippets/format-features/markdown-features.rst), [`admin/memory.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/admin/memory.rst))

- States: Untranslated, Needs editing (fuzzy or translator action), **Needs rewriting (source changed)**, Needs checking (source review), Translated / Waiting for review, Approved (only reviewers can change it; translators can only suggest), Read-only. Suggestions live only in Weblate. "Needs editing" and "Needs rewriting" are separate states; that is the distinction gettext loses.
- MT workflows are explicit and configurable: add as translation, add as "Needing edit" (with a commit policy that skips those), or add as suggestion that needs acceptance. The docs recommend filtering on `state:empty` "to fill empty translations without replacing existing human work".
- Markdown units get `md-text`, `auto-safe-html` and `strict-same` checks. The format table says markdown "Supports flags: No", so states for markdown live only in Weblate's database. That is a direct conflict with "git is the source of truth".
- By default each markdown occurrence is a separate unit "to provide line-based context", and the docs warn that reordering table rows "can lead to translation loss". The fix (`markdown_merge_duplicates`) drops location context. **This is the clearest real-world evidence against positional identity.**
- TM entries are "active" or "pending" (pending gets a quality penalty), and "autoclean" replaces older automatic entries once a translation is approved. Do not let unreviewed MT pollute the TM.

**Transifex Native** ([`core_components.md`](https://github.com/transifex/native-specs/blob/master/core_components.md), [`packages/native/src/utils.js`](https://github.com/transifex/transifex-javascript/blob/master/packages/native/src/utils.js))

- Keys are "automatically generated using the source string and its context" (an MD5-looking hash), with optional custom keys. Same model as Lingui.
- Translations are served at runtime from a CDS, so translation updates do not need a redeploy. That matches nuxt.com's runtime rendering better than compile-time catalogues do.
- Transifex docs (`docs.transifex.com`) were blocked, so I did not cover their review states.

**GitLocalize** (docs blocked; observed bot PR [`Sonolus/wiki#168`](https://github.com/Sonolus/wiki/pull/168))

- The `gitlocalize-app` bot opens one PR per locale per file. The commit is authored by the translator (`Translate 1.1.4.md via GitLocalize`), and the PR body links back to a review page on GitLocalize.
- The unit in git is the whole translated markdown file. Whatever segment state GitLocalize keeps lives on their side.

**Mozilla Pontoon** ([spec 0107 "Pretranslated status"](https://github.com/mozilla/pontoon/blob/main/specs/0107-pretranslated-status.md), [`managing-pretranslation.md`](https://github.com/mozilla/pontoon/blob/main/documentation/docs/admin/managing-pretranslation.md), [localizer docs: Pretranslation](https://mozilla-l10n.github.io/localizer-documentation/tools/pretranslation.html), [`sync/README.md`](https://github.com/mozilla/pontoon/blob/main/pontoon/sync/README.md), [`translations_to_repo.py`](https://github.com/mozilla/pontoon/blob/main/pontoon/sync/core/translations_to_repo.py))

- Pretranslation fills a new string from a 100% TM match, otherwise from Google AutoML with a per-locale model trained on Pontoon's own TM. The string is shipped to the repo and product immediately and stays marked "pretranslated" until a localiser approves or rejects it. Turnaround is "normally under 30 minutes".
- Spec 0107 exists because pretranslations used to be stored as Fuzzy, and gettext Fuzzy means "do not ship". They renamed the status to Pretranslated and started treating gettext fuzzy as Missing. **Lesson: "machine-filled, shippable, unreviewed" and "stale, do not ship" are different states, and conflating them causes real breakage.**
- Opt-in is per locale and project, with explicit gates: an active manager in the last 2 months, fewer than 400 missing strings, average review time under 3 weeks. It is disabled when the approval rate drops below 40% or review time exceeds 6 weeks. The Insights tab tracks approval rate, chrF++ on rejected strings, and time-to-review. **This is the best MT governance model I found, and it is directly reusable.**
- Sync keeps Pontoon's version when a string changed in both Pontoon and VCS, so the DB wins (see section 3).

**inlang ecosystem** ([`docs/data-model.md`](https://github.com/opral/inlang/blob/main/docs/data-model.md), [`docs/version-control.md`](https://github.com/opral/inlang/blob/main/docs/version-control.md), [`docs/unpacked-project.md`](https://github.com/opral/inlang/blob/main/docs/unpacked-project.md), [message format plugin](https://github.com/opral/inlang/blob/main/packages/plugins/inlang-message-format/README.md), [Fink VC blog](https://github.com/opral/inlang/blob/main/blog/version-control-features-in-fink/index.md); Paraglide [`message-keys.md`](https://github.com/opral/paraglide-js/blob/main/docs/message-keys.md), [`checking-translations.md`](https://github.com/opral/paraglide-js/blob/main/docs/checking-translations.md), [`markup.md`](https://github.com/opral/paraglide-js/blob/main/docs/markup.md))

- The data model is Bundle -> Message (per locale) -> Variant (pattern), "heavily inspired by" MF2, in SQL. I saw no review state or provenance fields in the documented types (my reading; possibly handled by Lix change metadata).
- Paraglide recommends **random human-readable keys** (`penguin_purple_shoe`) and argues that renaming keys "breaks the linkage between translations" and loses history. This is the opposite of the source-hash approach. It is right for UI strings whose copy changes while their identity does not, and wrong for docs paragraphs that have no stable author-assigned identity.
- "Lint rules" are deprecated: `inlang lint` now does nothing, and `inlang check` covers missing translations, missing/unknown variables, missing markup, and unused messages. Placeholder parity checking is the bit worth copying.
- Fink's review, conflict-resolution and history features are described as "explorative design research" for Lix, so I would not treat them as shipped precedent.

**Lingui** ([`generateMessageId.ts`](https://github.com/lingui/js-lingui/blob/main/packages/message-utils/src/generateMessageId.ts), [`explicit-vs-generated-ids.md`](https://github.com/lingui/js-lingui/blob/main/website/docs/guides/explicit-vs-generated-ids.md), [`ref/vue.md`](https://github.com/lingui/js-lingui/blob/main/website/docs/ref/vue.md), [`ref/extractor-vue.md`](https://github.com/lingui/js-lingui/blob/main/website/docs/ref/extractor-vue.md))

- ID = first 6 chars of base64url(sha256(message + U+001F + context)). Duplicates merge automatically; `context` separates homographs ("right" as direction vs correctness).
- Lingui itself lists the costs: any copy edit changes the ID ("loose coupling" is the stated benefit of explicit IDs), and non-technical TMS edits are harder.
- `@lingui/vue` (6.11, first published 2026-10-28 per the npm registry, so days old) has template macros: `<Trans>Hello <0>{{ name }}</0></Trans>` compiles to an ID plus message with numbered `<0>...</0>` element placeholders (`<pc>` semantics) and `{0}` positional values (`<ph>` semantics). The extractor mirrors Vue's `whitespace` compiler option because whitespace changes the hash. That detail matters for any hash-from-source scheme.

### How large docs projects run localisation

**MDN** ([`translated-content` CONTRIBUTING](https://github.com/mdn/translated-content/blob/main/CONTRIBUTING.md), [`fred` translation banner](https://github.com/mdn/fred/blob/main/components/translation-banner/server.js), [discussion #741 "Experiment: German translation"](https://github.com/orgs/mdn/discussions/741), [`translated-content-de`](https://github.com/mdn/translated-content-de))

- Freshness is a per-file `l10n.sourceCommit` frontmatter hash. The "Has a source commit property" update section of CONTRIBUTING literally reads "XXX Write me...". Even MDN has not documented the update workflow for its own staleness marker.
- Only "active locales" with maintenance teams accept updates. Locales were removed when unmaintained (German was removed in 2022 as "incomplete, outdated, and no longer maintained").
- German returned in Nov 2024 as a full GPT-4o translation of 12,500+ pages, updated by a daily workflow. Pre-processing replaces code blocks with placeholders and converts macros to links; post-processing fixes "well-known recurring syntax errors". It was exposed to search engines from December 2024.
- The banner is page-level and honest per locale: German says it "was automatically translated from English and may contain errors" with a link to the experiment; the others say "translated from English by the community". There is a "View in English" button and an "Always switch to English" button.
- MDN's own survey (1,900 respondents): 62% would still prefer English; concerns included rejecting AI translation as inaccurate, not wanting to be redirected, and asking for community review. The 2025 comments on #741 are users asking how to disable the translations entirely. The stated vision is "machine translation, and community reviews", but I could not find a review workflow in the repo; recent PRs are dependency bumps, and translations appear to land by direct workflow commits.

**Vue docs** ([`vuejs-translations/guidelines` README](https://github.com/vuejs-translations/guidelines/blob/main/README.md), [`ryu-cho` README](https://github.com/vuejs-translations/ryu-cho/blob/main/README.md))

- One repo per language. Ryu-Cho watches upstream commits under a path and opens an issue/PR per upstream commit in the translation repo. Staleness is "there is an open sync issue".
- As of the policy update on 2026-04-30 (commit `23e2acc15e`), **Vue core docs no longer accept new translations**, citing "AI-assisted translation quality is now high enough that the benefit of maintaining a separate official translation is much smaller", the ongoing sync burden, and the risk that a stale translation on an official domain misleads readers more than English does. Unmaintained translations may lose their `*.vuejs.org` domain.
- They keep English heading anchors (`## Translated {#original-header}`) so cross-links survive. That is relevant to comark: heading ids should be source-derived, not translated.

**react.dev** ([`translations.react.dev` README](https://github.com/reactjs/translations.react.dev/blob/main/README.md), [`scripts/README.md`](https://github.com/reactjs/translations.react.dev/blob/main/scripts/README.md), example sync PR on [`es.react.dev`](https://github.com/reactjs/es.react.dev/pulls?q=sync))

- A fork per language. A weekly bot merges upstream and lists "files [that] have conflicts and may need new translations" as a checklist in the PR body. Git merge conflicts are the staleness signal, which only fires when the same lines changed.
- New languages need more than one maintainer, and a subdomain is granted only after "sustained progress". Maintainers inactive for a month can be replaced.

**Astro docs** ([`lunaria.config.ts`](https://github.com/withastro/docs/blob/main/lunaria.config.ts), [contributor i18n guide](https://github.com/withastro/contribute.docs.astro.build/blob/main/src/content/docs/guides/i18n.mdx), [Starlight i18n guide](https://github.com/withastro/starlight/blob/main/docs/src/content/docs/guides/i18n.mdx))

- `i18nReady: true` frontmatter is Lunaria's `localizableProperty`: pages enter tracking only when authors say they are stable. Ignored keywords include `typo`, `en-only`, `broken link`.
- Policy: "We do not accept automated/machine translations ... There is no additional value to the reader if we provide machine translations, but there is additional maintenance cost for us." This is the strongest counter-position to Daniel's plan, and the plan should answer it: the value has to come from human review on top of MT, not from MT itself.
- Starlight serves untranslated pages at `/fr/about` with English content and a "not yet translated" notice. Simple for readers, but it creates duplicate-content URLs (see SEO).
- Review happens in GitHub PRs by language "crews". PRs should touch at most 2 or 3 pages so they can be reviewed quickly.

**Kubernetes** ([`localization.md`](https://github.com/kubernetes/website/blob/main/content/en/docs/contribute/localization.md), [`outdated_content.html`](https://github.com/kubernetes/website/blob/main/layouts/partials/docs/outdated_content.html), [`lsync.sh`](https://github.com/kubernetes/website/blob/main/scripts/lsync.sh), [`l10n-outdatedness-triage.py`](https://github.com/kubernetes/website/blob/main/scripts/l10n-outdatedness-triage.py))

- The in-page "outdated" banner fires when the localised page's Hugo `Lastmod` is older than the English page's. `lsync.sh` diffs English changes since the localised file's last commit.
- File dates were not good enough, so a 2026 script classifies pages as Strong/Moderate/No "signal" of outdatedness using missing H2s, missing code blocks, length gaps, and per-script calibration (for example, Japanese line counts). **A large project resorting to structural heuristics is the best argument that file-level staleness fails at scale.**
- Policy: "Machine-generated translation is insufficient on its own ... requires extensive human review." Approvers are per-language OWNERS teams.

**GitHub Docs** ([`data/ui.yml`](https://github.com/github/docs/blob/main/data/ui.yml), [`HeaderNotifications.tsx`](https://github.com/github/docs/blob/main/src/frame/components/page-header/HeaderNotifications.tsx), [`correct-translation-content.ts`](https://github.com/github/docs/blob/main/src/languages/lib/correct-translation-content.ts), [`count-translation-corruptions.yml`](https://github.com/github/docs/blob/main/.github/workflows/count-translation-corruptions.yml), [writing content to be translated](https://github.com/github/docs/blob/main/content/contributing/writing-for-github-docs/writing-content-to-be-translated.md))

- Disclosure is a dismissible, cookie-remembered page banner on every non-English page: "Some of this page may have been machine-translated or translated using AI." It is honest but vague, because they cannot say *which* part.
- `correct-translation-content.ts` is ~2,400 lines of regexes that repair Liquid tags (`{% data variables.x %}`) corrupted by translation, and a CI workflow counts "translation corruptions". **This is what happens when protected spans are not tokenised before translation.**
- They publish authoring guidance for translatability (short sentences, no stacked modifiers). Cheap, and worth copying into Nuxt's docs style guide.

**Microsoft Learn** (observed in the HTML of a `ja-jp` article on `learn.microsoft.com`)

- Pages carry `<meta name="ms.translationtype" content="MT">` plus `loc_version` and `loc_source_id`, and have a "Read in English" toggle. Page-level, machine-readable provenance. I did not find sentence-level markers in the current HTML.

**Wikipedia Content Translation** ([`doc/MTAbuseCalculation.md`](https://github.com/wikimedia/mediawiki-extensions-ContentTranslation/blob/master/doc/MTAbuseCalculation.md))

- Per paragraph, it computes "unmodified MT %" as LCS of word tokens divided by the larger token count, on plain text. Warning or block above 85% (95% if the user dismissed the warning). Publishing is gated on the share of problematic sections; borderline pages go into a tracking category for community review.
- **This gives an objective way to tell "human-edited" from "human clicked accept".** For nuxt.com, it could decide whether a segment shows as "machine, reviewed" or "human-edited", and it can feed reviewer-quality metrics.

## 3. Git-backed translation stores

Given the parent's decision (a separate git repo of segment records), these are the precedents for record layout and for the "web edit commits to git" write path.

| Store | On-disk layout | Diffability | Conflict-proneness | Web-edit write path | Attribution |
|---|---|---|---|---|---|
| Weblate | the project's own translation files (PO, markdown, JSON...) in the upstream repo; state stored in-file only when the format supports it ([`workflows.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/workflows.rst)) | as good as the format: PO is fine, markdown is file-level | high when files are edited both upstream and in Weblate; squash merges of Weblate commits break later rebases ([`continuous.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/admin/continuous.rst) "Avoiding merge conflicts") | "lazy commits" grouped per author per component, flushed on conflict / upstream merge / age (`commit_pending_age`); optional push on commit, or PR via GitHub App / Gitea / Bitbucket ([`projects.rst`](https://github.com/WeblateOrg/weblate/blob/main/docs/admin/projects.rst)) | commits grouped by author; squash add-on can group "per author and language" and append `Co-authored-by:` for every translator ([add-ons](https://github.com/WeblateOrg/weblate/blob/main/docs/snippets/addons-autogenerated.rst)) |
| Pontoon | upstream repo files (FTL, PO, XLIFF, JSON); Pontoon DB is authoritative between syncs ([`sync/README.md`](https://github.com/mozilla/pontoon/blob/main/pontoon/sync/README.md)) | format-dependent | low in practice because "the version in Pontoon is retained" on simultaneous change, i.e. the DB silently wins | periodic sync job commits directly to the configured branch; writes approved, pretranslated-without-warnings and fuzzy translations ([`translations_to_repo.py`](https://github.com/mozilla/pontoon/blob/main/pontoon/sync/core/translations_to_repo.py)) | single bot author (`VCS_SYNC_NAME`), message `Pontoon/<project>: Update <locales>`, one `Co-authored-by: name (locale) <email>` trailer per translator |
| inlang | `project.inlang/settings.json` tracked; messages in plugin files such as `messages/{locale}.json` (flat `key: pattern`); canonical form is a packed Lix `.inlang` snapshot ([`unpacked-project.md`](https://github.com/opral/inlang/blob/main/docs/unpacked-project.md)) | JSON is line-diffable; the packed snapshot "does not map cleanly" | one big file per locale means unrelated edits touch the same file; adjacent-line JSON edits conflict (inferred) | Fink / Lix change proposals and review are described as design research ([blog](https://github.com/opral/inlang/blob/main/blog/version-control-features-in-fink/index.md)) | Lix records authorship (stated in design notes; not verified) |
| lingo.dev | `i18n.lock` YAML of source checksums plus translated output files in the repo ([`lockfile.ts`](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/src/cli/utils/lockfile.ts)); new CLI `.lingo/lock.json` of file sha256 ([example](https://github.com/lingodotdev/markdown-docs-localization-example/blob/main/.lingo/lock.json)) | lockfile diffs are hash noise; target files diff as prose | lockfile is one file touched by every run; the code includes `deduplicateLockfileYaml` to repair duplicate keys, which suggests merges have produced them (inferred) | CI step or GitHub App: "opens or updates a translation pull request, or translations land as a commit in the pull request that changed the source" ([README](https://github.com/lingodotdev/lingo.dev/blob/main/packages/cli/README.md)) | bot; no per-translator attribution in git |
| GitLocalize | translated whole files at locale paths | prose diff per file | one PR per file per locale; low while files are disjoint | bot PR (`gitlocalize-app`) per locale/file, linking a GitLocalize review page ([example](https://github.com/Sonolus/wiki/pull/168)) | commit authored by the translator, PR opened by the bot |
| mdbook-i18n-helpers | `po/<lang>.po`, one per locale; `msgid` is markdown; `#:` refs with line numbers ([USAGE](https://github.com/google/mdbook-i18n-helpers/blob/main/i18n-helpers/USAGE.md)) | good per entry; but `msgmerge` rewrites refs and the header, so diffs are huge | high: every `msgmerge` touches `POT-Creation-Date` and many `#:` lines; Comprehensive Rust forbids mixing merge and translation in one PR ([TRANSLATIONS.md](https://github.com/google/comprehensive-rust/blob/main/TRANSLATIONS.md)) | no web write path; humans open PRs with Poedit output | git author = translator |
| OmegaT team project | `omegat/project_save.tmx` in git, one `<tu>` per source segment, per-`<tuv>` `changeid`/`changedate` ([example](https://github.com/LibreOffice/OmegaT/blob/master/cs/LOGuides/omegat/project_save.tmx)) | XML, roughly sorted by source text, so mostly stable | single large file per project; OmegaT merges on sync (from my knowledge of team projects; not verified here) | the desktop client commits and pushes on save/sync | per-entry author inside the record, independent of git author |

What this implies for a separate segment repo:

- **One record per file, path derived from the segment hash** (for example `segments/<locale>/<hh>/<hash>.json`, or one small file per source hash holding all locales) is the only layout here that makes unrelated edits never conflict. Every existing tool that uses one file per locale (PO, inlang JSON, TMX, lockfile) has conflict or churn problems that it then has to work around. Weblate's per-author batching and Comprehensive Rust's "do not mix" rule are both workarounds.
- **Keep volatile locators out of the record.** mdbook's line-number `#:` refs and lingo's positional keys cause most of their churn. Where a segment occurs (repo, branch, path, anchor) belongs in a derived index that is regenerated from sources, not in the translation record.
- **Attribution: put the author in the record and in git.** Pontoon's bot-author-plus-`Co-authored-by` trailers and Weblate's grouped commits both keep the git log readable, but they make `git blame` on a single translation useless. OmegaT puts `changeid` in the record itself. Because nuxt.com wants "verified by @x" in the UI, the record has to carry it anyway; git attribution is a bonus.
- **Batching:** Weblate's lazy-commit triggers (someone else edits the same string, upstream merge, age threshold) are a well-tested policy. Copy them, rather than committing per keystroke or per day.
- **PR vs direct commit:** Pontoon and MDN-de commit directly; GitLocalize and lingo.dev open PRs. For a store where review happens *in the web UI*, a second review in GitHub PRs is duplicate work. Direct commits by a bot with trailers, behind a protected branch that only the bot can write, look right to me. PRs are then for bulk imports and MT runs.
- **Do not squash** if the web app also rebases: Weblate documents exactly how squash merges wedge its sync.
- **DB as cache, never as truth.** Pontoon and Weblate both keep state the files cannot represent (pretranslated, suggestions, markdown flags) in a DB. With git as truth, every state we care about (provenance, review, previous source) must live in the record.

Which ones have a placeholder model that matches XLIFF `<ph>`/`<pc>`:

- **Yes, natively:** XLIFF itself, Okapi, OmegaT (short `<a0>`/`<g1>` tags; from my memory of OmegaT, not verified here).
- **Yes, in a plain-text grammar close to the parent's choice:** translate-toolkit (`[text]{1}` is `<pc>`, `{1}` is `<ph>`) and therefore Weblate markdown; Lingui (`<0>...</0>` is `<pc>`, `{0}` is `<ph>`); MF2 and Paraglide (`{#tag}...{/tag}` is `<pc>`, `{#tag/}` is `<ph>`). Pontoon's sync layer serialises messages through `moz.l10n` to XLIFF, so it can probably carry inline markup (inferred from imports in `translations_to_repo.py`).
- **Partial:** lingo.dev hashes only code into `CODE_PLACEHOLDER_*`; Crowdin hides tags and auto-substitutes them in TM matches; inlang message format supports variables `{name}` only.
- **No:** mdbook-i18n-helpers, po4a and Sphinx keep raw markup in the `msgid` (Sphinx at least checks cross-reference parity).

The parent's grammar (text, emphasis, numbered placeholders) is closest to translate-toolkit's. One design point to settle: whether a link is a paired placeholder with translatable text (`[text]{1}`, i.e. `<pc>`) or two standalone ones. Every tool that handles links well treats them as paired.

Precedent for a per-segment "verified by" badge shown to readers: **I found none.** The closest are:

- Sphinx `translation_progress_classes`: per-node `translated`/`untranslated` CSS classes in the HTML. Binary, with no person or review state, and intended for translators.
- XLIFF ITS `revPerson`/`revOrg`: the data model exists, but I know of no reader UI that uses it.
- Page-level disclosure: MDN banner, GitHub Docs banner, MS Learn `ms.translationtype` meta, Kubernetes outdated banner, Wikipedia CX tracking category.
- Translator-facing in-page editing: Crowdin In-Context.

So per-segment provenance for readers would be new. That is a reason to design the UI carefully (see open questions), not a reason to avoid it.

## 4. Patterns worth adopting

1. **Content-addressed segment identity with a stable context salt.** Key = hash(normalised tokenised source + optional context), as in gettext `msgid` and Lingui. This dedups identical paragraphs across `3.x`/`4.x`/`main` and across module repos, it survives reordering (Weblate's line-context lesson), and it keeps state independent of any one git source. Use `context` only when the same text must translate differently.
2. **Explicit previous-source linkage.** When a source hash disappears and a close match appears, create the new record with `previousSource` and `previousTranslation` (gettext `#|`) so the editor can show a word diff. Find candidates the way OmegaT/Okapi do (token Levenshtein or trigram Dice, threshold around 0.6 to 0.75), scoped to the same document and anchor first, and global only as a fallback, to avoid gettext's cross-page surprises.
3. **Three orthogonal axes instead of one state.** *Origin* (mt / tm / human), *review* (XLIFF `translated` / `reviewed` / `final`, or Weblate's waiting-for-review / approved), and *freshness* (current / stale-with-previous-source). Pontoon spec 0107 and Weblate's Needs editing vs Needs rewriting both show what breaks when these share one field. Map *origin* onto XLIFF `subState` and keep MT output as a candidate (`mtc:match type="mt"`) until a human accepts it.
4. **Measure the human edit.** Store the MT candidate alongside the accepted text and compute Wikipedia's unmodified-MT ratio. That separates "human-edited" from "human-verified" objectively, and it lets you audit reviewers who rubber-stamp.
5. **Tokenise protected spans before anyone sees the text**, and enforce placeholder parity on save: same placeholder multiset, paired placeholders well-nested (Sphinx xref check, `inlang check` missing-variable, Weblate `md-text`). GitHub's 2,400-line Liquid repair file is the cost of not doing this.
6. **Per-locale MT governance with numbers.** Copy Pontoon: enable MT pre-fill per locale only with an active reviewer; publish approval rate and time-to-review; switch off when approval < 40% or review time > 6 weeks. This also answers Astro's "no value to readers" objection: MT is only on where humans are actually reviewing it.
7. **Maintainer-side "do not invalidate".** Crowdin's diff dialog and Lunaria's `fix typo` keyword, done per segment: when a source edit is trivial (typo, link target), a maintainer can carry translations forward, keeping their review state, after seeing the diff.
8. **Version the segmenter and ship a normaliser**, as mdbook does. Changing the comark segmentation rules must not orphan the store.
9. **Author controls in source**: `i18n:skip`, translator comments (mdbook), `i18nReady`/`localizableProperty` (Astro/Lunaria), and English heading anchors (Vue). For comark these could be component props or comments.
10. **A machine-readable status file** (Lunaria `status.json`, as consumed by npmx) generated from the store, for dashboards and for the page-level summary.
11. **Readers stay in control of language**: "View in English" and "Always use English" on every translated page (MDN), and no automatic redirects (Google guidance; MDN's own survey and complaints).

## 5. Patterns to avoid

1. **File-level freshness** (Lunaria, MDN `sourceCommit`, Kubernetes `Lastmod`, Ryu-Cho, react.dev merge conflicts). It cannot say what changed, does not work across repos, and ends in heuristics (Kubernetes triage script).
2. **Positional identity** (lingo.dev `md-section-N`, Weblate line context, mdbook line refs). Inserting a paragraph invalidates or churns everything after it.
3. **Regex markdown splitting** (lingo.dev loader). Segment on the comark AST.
4. **Whole-file MT overwrite** (lingo.dev target files, MDN German daily runs, as far as I can tell). Human corrections get no protected status, and the first human edit is the last one that survives.
5. **One "fuzzy" bit** that means both "MT draft" and "stale". (Pontoon had to undo it.)
6. **Silent fallback**: mdbook drops fuzzy entries and shows English with no marker; Starlight serves English at a localised URL. Readers should always be able to tell what they are reading.
7. **State that only lives in a DB** (Weblate markdown "Supports flags: No", Pontoon pretranslated). It contradicts git-as-truth and makes self-hosting lossy.
8. **One file per locale as the git record** (PO, inlang JSON, TMX, lockfile). It is conflict-prone and makes `msgmerge`-style churn unreviewable.
9. **Squash-merging bot commits** when the bot later rebases (Weblate).
10. **Polluting TM with unreviewed MT.** Weblate's pending/active TM status and autoclean exist for this. Only reviewed segments should feed TM and fine-tuning (Pontoon trains on its own approved TM).
11. **Vague page banners as the only disclosure** ("Some of this page may have been machine-translated"). That is acceptable as a fallback, but it is the thing segment-level provenance is meant to improve on.

## 6. SEO

What Google's current docs actually say:

- [Spam policies, "Scaled content abuse"](https://developers.google.com/search/docs/essentials/spam-policies) (last updated 2026-08-28): "many pages are generated for the primary purpose of manipulating search rankings and not helping users ... no matter how it's created". Examples include "automated transformations like synonymizing, translating, or other obfuscation techniques), where little value is provided to users". It says: "If you're hosting such content on your site, exclude it from Search."
- The [March 2024 announcement](https://developers.google.com/search/blog/2024/03/core-update-spam-policies) says the policy "builds on our previous spam policy about automatically-generated content". My recollection is that the older policy explicitly listed "text translated by an automated tool without human review or curation before publishing". I could not verify that wording, because `web.archive.org` is blocked here, so treat it as unverified.
- [Creating helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) (2026-10-05): raters judge "Effort", and the example of high effort is literally "translating a poem manually". It also asks whether automation is "self-evident to visitors through disclosures". [Using generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) (2026-10-01) points back at scaled content abuse.
- [Localized versions / hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions) (2026-09-21): "Localized versions of a page are only considered duplicates if the main content of the page remains untranslated." Annotations must be bidirectional, and there is an `x-default` fallback.
- [Managing multi-regional sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites) (2025-12-10): use "a single language for content and navigation on each page" and avoid "side-by-side translations"; avoid automatic redirects based on guessed language.
- [Translated results](https://developers.google.com/search/docs/appearance/translated-results) (2025-12-10): Google itself machine-translates results into some languages (French, German, Spanish, Portuguese, Korean, Hindi and others), and `notranslate` opts out. This is Astro's point in Google's words: raw MT of nuxt.com adds little that Google and browsers do not already provide.

My reading (not Google's words): there is no current rule that MT pages must be `noindex`. The risk is MT at scale with little added value, and mixed-language pages. So:

- Index a locale page only when it clears a reviewed-coverage threshold (po4a's 80% is a reasonable starting point, measured on reviewed segments, not just filled ones). Pages below the threshold can still be served to readers who choose the locale, with `noindex` and without `hreflang` entries.
- Only emit `hreflang` pairs between pages that are both indexable, and keep them bidirectional.
- Avoid English fallback paragraphs inside an indexed localised page beyond a small fraction, because they are the "untranslated main content" and "side-by-side" cases.
- Disclose MT on the page (and possibly in metadata, as MS Learn does with `ms.translationtype`).
- Never redirect by `Accept-Language`; suggest instead.

## 7. UI-string layer recommendation

What I found:

- **`@nuxtjs/i18n`** ([options](https://github.com/nuxt-modules/i18n/blob/main/docs/content/docs/04.api/00.options.md), [SEO guide](https://github.com/nuxt-modules/i18n/blob/main/docs/content/docs/02.guide/06.seo.md)): the strongest Nuxt-native routing and SEO story (`useLocaleHead` for `lang`, `hreflang`, canonical and OG locale; four prefix strategies; domains; custom localised paths; browser detection with cookie). Weight comes from vue-i18n's runtime and message compiler (there are `dropMessageCompiler` and `runtimeOnly` knobs) and from per-locale route duplication (`experimental.compactRoutes`, expected to become the default in v11). `prerenderMessages` and `optimizeMessageBundling` show the bundle/build cost is being worked on. `nuxt-i18n-micro`'s [README](https://github.com/s00d/nuxt-i18n-micro) reports `@nuxtjs/i18n` 10.6 at +3.2s build and +433 MB peak RSS over a baseline. Those are self-reported numbers.
- **Paraglide JS** ([comparison](https://github.com/opral/paraglide-js/blob/main/docs/comparison.md), [strategy](https://github.com/opral/paraglide-js/blob/main/docs/strategy.md), [Vue component](https://github.com/opral/paraglide-js/blob/main/framework/vue/README.md)): compile-time message functions, tree-shaken, typed, with MF2-style markup and a recent Vue template fix so `m.key` reads tree-shake. There is no official Nuxt module (the old Vite adapter packages are deprecated, and `@inlang/paraglide-nuxt` does not exist on npm). Its routing and detection strategies would overlap with Nuxt's router. Translation changes require a rebuild. It recommends random keys.
- **Lingui** (see above): source text as message, hashed IDs, PO catalogs, and now Vue template macros and an SFC extractor. Philosophically the closest to the docs store, but `@lingui/vue` is days old.
- **vue-i18n standalone, i18next, typesafe-i18n, nuxt-i18n-micro**: all key-based dictionaries; none would share identity with the docs store. I did not verify a maintained `.vue` template extractor for vue-i18n.

Recommendation:

- **Do not build a new UI-string framework now.** Split the problem: *routing, locale detection and SEO* versus the *message catalogue*. The first is where `@nuxtjs/i18n` is genuinely good and where alternatives are weakest in Nuxt. The second is where the new store adds value.
- For nuxt.com, keep `@nuxtjs/i18n` for routing/SEO, and make the segment store export its UI-string catalogue (keyed JSON) so UI strings get the same provenance, review and dashboard as docs. Treat UI strings as keyed records in the same store (explicit stable keys, as Paraglide argues), not as source-hashed ones: UI copy changes often while its identity does not, and nobody wants a button label to lose its translations because of a capitalisation fix.
- Re-evaluate a source-text, hash-identified, compile-time layer (Lingui's model, or Paraglide's compiler fed from the store) once `@lingui/vue` has some mileage. It is viable in Vue templates today, via a compile-time macro that hashes the template text with whitespace semantics identical to the Vue compiler's. It is not viable via runtime `$t('literal text')` without an extractor.
- Honest trade-off: keeping `@nuxtjs/i18n` keeps the weight and vue-i18n's message syntax (not MF2). Moving to Paraglide or Lingui buys bundle size and type safety, but costs Nuxt-native routing/SEO, which you would have to rebuild or keep `@nuxtjs/i18n` for anyway.

## 8. Open questions for Daniel

1. **Is unreviewed MT shown to readers at all?** Options: never (Astro, Comprehensive Rust); behind an explicit opt-in per reader; or by default with markers (MDN de, GitHub Docs). And is it indexed?
2. **What does a reader see for a stale human translation?** The old human text marked stale, fresh MT marked as MT, or English? Comprehensive Rust picks consistency (old source); MDN picks freshness (MT).
3. **Which locales, and gated how?** Vue just stopped accepting new translations over sync burden. Pontoon's numeric opt-in and opt-out criteria are one answer. Do you want a public, measurable bar for a locale to be listed and indexed?
4. **What does "verified" mean, and who can do it?** One trusted reviewer or two? Can the person who edited also verify? Does verification expire when the English changes trivially?
5. **Per-segment badges vs page-level summary.** No precedent exists for reader-facing per-segment provenance. Is it a quiet affordance (hover, or a toggle "show provenance") or always visible? Too much chrome may read as "this page is unreliable".
6. **Mixed-language pages.** Is an English fallback paragraph inside a French page acceptable, and up to what share before the page is `noindex` or not offered?
7. **Scope of identity and TM.** Should a segment translated for `nuxt/nuxt` docs auto-apply in a module's docs if the text is identical? (Default yes with content hashing; the risk is identical text with different meaning.)
8. **Licensing and contributor terms** for the translation repo: same licence as the docs? Any CLA or DCO? This matters more once other projects self-host and share TM.
9. **Write path into git:** direct bot commits with `Co-authored-by` trailers (Pontoon) or PR batches (GitLocalize, lingo.dev)? Who can push to the store repo, and is GitHub identity the only login?
10. **Code blocks:** translate comments and strings inside code (mdbook does) or never (MDN de leaves them English)?
11. **Interop ambition:** should the store export and import XLIFF 2 (so Weblate, Okapi and OmegaT users can participate), or is a Nuxt-native JSON record format enough?
