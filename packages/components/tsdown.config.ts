import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: ['src/index.ts', 'src/vite.ts', 'src/runtime/react.ts', 'src/runtime/svelte.ts', 'src/runtime/vue.ts'],
  external: [/\.svelte$/],
  copy: [{ from: 'src/runtime/Text.svelte', to: 'dist/runtime' }],
})
