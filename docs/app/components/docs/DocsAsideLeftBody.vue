<script setup lang="ts">
const { sidebarNavigation } = useSubNavigation()

const contentNavVariants = useUIConfig('contentNavigation')
</script>

<template>
  <UContentNavigation
    aria-label="Pages"
    :collapsible="false"
    :highlight="contentNavVariants.highlight ?? true"
    :highlight-color="contentNavVariants.highlightColor"
    :variant="contentNavVariants.variant ?? 'link'"
    :color="contentNavVariants.color"
    :navigation="sidebarNavigation"
  >
    <template #link-title="{ link }">
      <DocsTruncatedLabel :text="link.title" />
    </template>
  </UContentNavigation>
</template>
