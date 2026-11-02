import type { CommandDef } from 'citty'
import { defineCommand, runMain } from 'citty'
import { subCommands } from './commands.ts'

export { checkoutSource } from './checkout.ts'
export type { CheckedOutSource } from './checkout.ts'
export { extractSource } from './extract.ts'
export type { ExtractedSource } from './extract.ts'

/** The `diglot` command. */
export const main: CommandDef = defineCommand({
  meta: { name: 'diglot', description: 'Segment-level translation for markdown documentation' },
  subCommands,
})

/** Runs the CLI with `process.argv`. */
export function run(): Promise<void> {
  return runMain(main)
}
