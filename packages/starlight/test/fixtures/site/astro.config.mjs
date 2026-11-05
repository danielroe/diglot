import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import diglot from '../../../src/index.ts'

export default defineConfig({
  integrations: [
    starlight({
      title: 'Fixture',
      locales: {
        root: { label: 'English', lang: 'en' },
        fr: { label: 'Français', lang: 'fr' },
      },
      editLink: { baseUrl: 'https://github.com/example/docs/edit/main/' },
      lastUpdated: true,
      sidebar: [{ label: 'Guides', translations: { fr: 'Guides' }, items: [{ autogenerate: { directory: 'guides' } }] }],
      plugins: [diglot({ translations: './translations' })],
    }),
  ],
})
