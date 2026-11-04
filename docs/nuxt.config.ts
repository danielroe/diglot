import process from 'node:process'
import { rehypeFocusableCode } from './utils/rehype-focusable-code'

// GitHub's themes keep every token colour above WCAG AA contrast on our backgrounds.
const CODE_THEME = { light: 'github-light-high-contrast', default: 'github-light-high-contrast', dark: 'github-dark-default' }

export default defineNuxtConfig({
  extends: ['docus'],
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },
  modules: ['@nuxt/fonts'],
  content: {
    build: {
      markdown: {
        rehypePlugins: {
          'focusable-code': { instance: rehypeFocusableCode },
        },
        highlight: {
          theme: CODE_THEME,
          langs: ['bash', 'diff', 'json', 'jsonc', 'md', 'mdc', 'ts', 'vue', 'yaml'],
        },
      },
    },
  },
  // Nuxt UI sets its own code theme here, with a separate `light` key that must be replaced too.
  mdc: {
    highlight: {
      theme: CODE_THEME,
    },
  },
  docus: {
    assistant: {
      enabled: false,
    },
  },
  fonts: {
    families: [
      { name: 'Geist', provider: 'fontsource', weights: [400, 500, 600, 700], styles: ['normal'], global: true },
      { name: 'Geist Mono', provider: 'fontsource', weights: [400, 500], styles: ['normal'] },
      { name: 'Martian Mono', provider: 'fontsource', weights: [500], styles: ['normal'] },
      { name: 'Grenze Gotisch', provider: 'fontsource', weights: [500, 700], styles: ['normal'], global: true },
    ],
    defaults: { subsets: ['latin'] },
  },
  site: {
    name: 'diglot',
    url: 'https://diglot.sh',
  },
  icon: {
    clientBundle: {
      scan: true,
    },
  },
  runtimeConfig: {
    // Server-only token that raises the GitHub rate limit when listing contributors.
    githubToken: process.env.GITHUB_TOKEN ?? '',
  },
})
