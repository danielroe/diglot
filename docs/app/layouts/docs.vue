<script setup lang="ts">
const route = useRoute()

// Remount instead of hydrating markup rendered for a previous route
const asideKey = ref(route.path)
const isAsideHydrated = ref(false)
watch(() => route.path, (path) => {
  if (!isAsideHydrated.value) {
    asideKey.value = path
  }
})
</script>

<template>
  <UMain id="main">
    <div
      class="hatch hatch-slim hatch-flush-top"
      aria-hidden="true"
    />
    <UContainer>
      <UPage>
        <template #left>
          <UPageAside :ui="{ root: 'overflow-y-auto overscroll-contain' }">
            <DocsAsideLeftTop />
            <LazyDocsAsideLeftBody
              :key="asideKey"
              hydrate-on-media-query="(min-width: 64rem)"
              @hydrated="isAsideHydrated = true"
            />
          </UPageAside>
        </template>
        <slot />
      </UPage>
    </UContainer>
  </UMain>
</template>
