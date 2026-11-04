<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()
const { forced: forcedColorMode } = useDocusColorMode()
const { subNavigationMode } = useSubNavigation()

// On the landing page the header melts into the hero until you scroll.
const isLanding = computed(() => route.path === '/')
const atTop = ref(true)
const isClear = computed(() => isLanding.value && atTop.value)

function updateScroll() {
  atTop.value = window.scrollY < 12
}

onMounted(() => {
  updateScroll()
  window.addEventListener('scroll', updateScroll, { passive: true })
})

onBeforeUnmount(() => window.removeEventListener('scroll', updateScroll))
</script>

<template>
  <a
    href="#main"
    class="sr-only z-[100] rounded-md bg-primary px-4 py-2 font-medium text-inverted focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
  >Skip to content</a>
  <UHeader
    :ui="{ center: 'flex-1', root: isClear ? 'bg-transparent border-transparent backdrop-blur-none' : undefined }"
    class="transition-[background-color,border-color] duration-300"
    :class="{ 'flex flex-col': subNavigationMode === 'header' }"
  >
    <AppHeaderCenter />

    <template #left>
      <AppHeaderLeft />
    </template>

    <template #right>
      <UContentSearchButton class="lg:hidden" />
      <UButton
        to="https://npmx.dev/org/diglot"
        target="_blank"
        color="neutral"
        variant="ghost"
        icon="i-custom-npmx"
        aria-label="diglot on npmx"
      />
      <UButton
        v-if="appConfig.github?.url"
        :to="appConfig.github.url"
        target="_blank"
        color="neutral"
        variant="ghost"
        icon="i-simple-icons-github"
        aria-label="GitHub"
      />
      <ClientOnly v-if="!forcedColorMode">
        <UColorModeButton />
        <template #fallback>
          <div class="size-8" />
        </template>
      </ClientOnly>
    </template>

    <template #toggle="{ open, toggle }">
      <IconMenuToggle
        :open="open"
        class="lg:hidden"
        @click="toggle"
      />
    </template>

    <template #body>
      <AppHeaderBody />
    </template>

    <template
      v-if="subNavigationMode === 'header'"
      #bottom
    >
      <LazyAppHeaderBottom />
    </template>
  </UHeader>
</template>
