import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

export default defineConfig({
  ...base,
  entry: ['src/index.ts', 'src/react.ts', 'src/svelte.ts', 'src/vite.ts', 'src/vue.ts'],
  deps: { neverBundle: [/\.svelte$/] },
  copy: [{ from: 'src/Text.svelte', to: 'dist' }],
})
