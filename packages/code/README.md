# @diglot/code

Code-block comment extraction for [diglot](../../README.md). Finds the prose comments of a code block with a per-language tokenizer, turns each comment line into a `code-comment` segment, and replaces only the comment text when applying a translation.

```bash
pnpm add @diglot/code @diglot/core
```

## Usage

```ts
import { applyCode, extractCode } from '@diglot/code'

const { segments } = extractCode(code, 'ts')
const { code: translated, report } = applyCode(code, 'ts', translations)
```

For adapters:

- `findComments(code, language)` returns `{ line, start, end, text }` for each prose comment line, where `[start, end)` are offsets of the text in the code
- `commentDraft(comment, language, context)` converts a comment to a segment draft; inline code and URLs become placeholders
- `replaceComments(code, replacements)` substitutes comment texts

Supported languages: JavaScript and TypeScript (`js`, `ts`, `jsx`, `tsx`, `mjs`, `cjs`), Vue and HTML (including `<script>` and `<style>` blocks), CSS, SCSS and Less, shell (`bash`, `sh`, `zsh`), dotenv and ini, YAML, TOML, JSON5 and JSONC.

Not extracted: twoslash directives (`// ^?`, `// @errors`, `// ---cut---`), Shiki notations (`// [!code ++]`), tool pragmas (`eslint-disable`, `@ts-expect-error`, `#region`), commented-out code, and comments with fewer than two words.
