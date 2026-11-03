import type { Plugin } from 'vitest/config'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vitest/config'

const builtins = new Set(builtinModules)

function noBuiltins(): Plugin {
  return {
    name: 'no-builtins',
    enforce: 'post',
    transform(code, id) {
      for (const node of this.parse(code).body) {
        const source = 'source' in node && node.source ? String(node.source.value) : undefined
        if (source && (source.startsWith('node:') || builtins.has(source)))
          throw new Error(`${id} imports the Node built-in "${source}"`)
      }
    },
  }
}

export default defineConfig({
  test: {
    coverage: {
      include: ['packages/*/src'],
      reporter: ['text', 'json', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.edge.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [noBuiltins()],
        test: {
          name: 'edge',
          include: ['packages/*/test/**/*.edge.test.ts'],
          environment: 'edge-runtime',
        },
      },
    ],
  },
})
