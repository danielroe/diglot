#!/usr/bin/env node
import { existsSync } from 'node:fs'

async function main() {
  const dist = new URL('../dist/index.mjs', import.meta.url)
  const { run } = await import(existsSync(dist) ? dist.href : new URL('../src/index.ts', import.meta.url).href)
  await run()
}

main()
