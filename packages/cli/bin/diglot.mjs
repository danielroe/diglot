#!/usr/bin/env node
import { existsSync } from 'node:fs'

const dist = new URL('../dist/index.mjs', import.meta.url)
const { run } = await import(existsSync(dist) ? dist.href : new URL('../src/index.ts', import.meta.url).href)

run()
