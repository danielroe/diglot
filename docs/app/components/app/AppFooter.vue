<script setup lang="ts">
const { data: attribution } = await useFetch('/api/footer-contributors', {
  default: () => ({ contributors: [{ login: 'danielroe', to: 'https://github.com/danielroe' }], remaining: 0 }),
})

// In the order of the packages in the repository README.
const packages = [
  { label: '@diglot/core', to: '/core/overview' },
  { label: '@diglot/comark', to: '/adapters/comark' },
  { label: '@diglot/mdast', to: '/adapters/mdast' },
  { label: '@diglot/code', to: '/adapters/code' },
  { label: '@diglot/store', to: '/store/overview' },
  { label: '@diglot/mt', to: '/machine-translation/overview' },
  { label: '@diglot/action', to: '/workflow/action/overview' },
  { label: '@diglot/cli', to: '/workflow/cli/overview' },
  { label: '@diglot/x18n', to: '/review-ui/overview' },
  { label: '@diglot/angular', to: '/integrations/angular' },
  { label: '@diglot/astro', to: '/integrations/astro' },
]

const learn = [
  { label: 'Introduction', to: '/guide/start/introduction' },
  { label: 'Quick start', to: '/guide/start/quick-start' },
  { label: 'Concepts', to: '/guide/concepts/segments' },
  { label: 'How-to guides', to: '/guide/how-to/configure' },
  { label: 'Nuxt example', to: '/guide/examples/nuxt-translations' },
  { label: 'Astro example', to: '/guide/examples/astro-site' },
  { label: 'Angular example', to: '/guide/examples/angular-app' },
]

const project = [
  { label: 'GitHub', to: 'https://github.com/danielroe/diglot' },
  { label: 'npmx', to: 'https://npmx.dev/org/diglot' },
  { label: 'MIT licence', to: 'https://github.com/danielroe/diglot/blob/main/LICENCE' },
]

const linkClass = 'underline decoration-default underline-offset-4 transition-colors hover:text-highlighted hover:decoration-current'
</script>

<template>
  <footer class="relative">
    <div
      class="hatch"
      aria-hidden="true"
    />
    <UContainer class="py-12">
      <div class="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div class="col-span-2 lg:col-span-1">
          <NuxtLink
            to="/"
            aria-label="diglot home"
            class="inline-flex"
          >
            <AppHeaderLogo />
          </NuxtLink>
          <p class="mt-4 max-w-xs text-sm text-muted">
            Segment-level, human-first translation for markdown documentation.
          </p>
          <p class="mt-6 max-w-xs text-xs leading-6 text-muted">
            Made with <span
              class="text-primary"
              role="img"
              aria-label="love"
            >♥</span> by
            <template
              v-for="(contributor, index) of attribution.contributors"
              :key="contributor.login"
            >
              <ULink
                :to="contributor.to"
                :class="linkClass"
              >
                {{ contributor.login }}
              </ULink>{{ index < attribution.contributors.length - 1 ? (attribution.remaining || index < attribution.contributors.length - 2 ? ', ' : ' and ') : '' }}
            </template>
            <template v-if="attribution.remaining">
              and
              <ULink
                to="/contributors"
                :class="linkClass"
              >
                {{ attribution.remaining }} other {{ attribution.remaining === 1 ? 'contributor' : 'contributors' }}
              </ULink>
            </template>
          </p>
        </div>

        <nav
          aria-label="Packages"
          class="max-sm:col-span-2"
        >
          <p class="eyebrow">
            Packages
          </p>
          <ul class="mt-4 grid gap-2 text-sm">
            <li
              v-for="link of packages"
              :key="link.to"
            >
              <ULink
                :to="link.to"
                class="font-mono text-toned transition-colors hover:text-highlighted"
              >
                {{ link.label }}
              </ULink>
            </li>
          </ul>
        </nav>

        <nav aria-label="Learn">
          <p class="eyebrow">
            Learn
          </p>
          <ul class="mt-4 grid gap-2 text-sm">
            <li
              v-for="link of learn"
              :key="link.to"
            >
              <ULink
                :to="link.to"
                class="text-toned transition-colors hover:text-highlighted"
              >
                {{ link.label }}
              </ULink>
            </li>
          </ul>
        </nav>

        <nav aria-label="Project">
          <p class="eyebrow">
            Project
          </p>
          <ul class="mt-4 grid gap-2 text-sm">
            <li
              v-for="link of project"
              :key="link.to"
            >
              <ULink
                :to="link.to"
                class="text-toned transition-colors hover:text-highlighted"
              >
                {{ link.label }}
              </ULink>
            </li>
          </ul>
        </nav>
      </div>
    </UContainer>
  </footer>
</template>
