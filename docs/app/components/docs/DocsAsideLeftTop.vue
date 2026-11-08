<script setup lang="ts">
const { subNavigationMode, sections } = useSubNavigation()

const topics = computed(() => sections.value.map((section) => {
  const slug = section.to.split('/')[1] ?? ''
  const topic = TOPICS.find(entry => entry.slug === slug)
  return { ...section, slug, meta: topic?.meta, accent: topic?.accent ?? 'lime' }
}))
</script>

<template>
  <nav
    v-if="subNavigationMode === 'aside'"
    aria-label="Topics"
  >
    <ul class="grid gap-1">
      <li
        v-for="topic of topics"
        :key="topic.to"
      >
        <NuxtLink
          :to="topic.to"
          class="topic-link"
          :style="{ '--topic-accent': `var(--color-${topic.accent}-500)` }"
          :aria-current="topic.active ? 'true' : undefined"
        >
          <span class="topic-icon">
            <TopicMark
              :topic="topic.slug"
              class="size-4"
            />
          </span>
          <span class="flex min-w-0 flex-1 flex-col leading-tight">
            <span class="text-sm font-medium">{{ topic.label }}</span>
            <span
              v-if="topic.meta"
              class="topic-meta truncate font-mono text-xs text-dimmed"
              :title="topic.meta"
            >{{ topic.meta }}</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
    <USeparator
      type="dashed"
      class="my-6"
    />
  </nav>
</template>
