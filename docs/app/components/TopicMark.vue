<script setup lang="ts">
const { topic } = defineProps<{
  /** The slug of the topic, such as `core` or `machine-translation`. */
  topic: string
}>()
</script>

<!--
  One abstract, two-tone mark per topic: the accent colour (`currentColor`) and a second tone that
  follows the text colour, echoing the two halves of the diglot mark.
-->
<template>
  <svg
    viewBox="0 0 32 32"
    aria-hidden="true"
    focusable="false"
    class="topic-mark"
  >
    <template v-if="topic === 'core'">
      <!-- A nucleus inside its orbit. -->
      <circle
        cx="16"
        cy="16"
        r="12"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
      />
      <circle
        class="ink"
        cx="16"
        cy="16"
        r="5"
      />
    </template>
    <template v-else-if="topic === 'adapters'">
      <!-- Two shapes that overlap and fit. -->
      <rect
        x="4"
        y="4"
        width="15"
        height="15"
        rx="4"
        fill="currentColor"
      />
      <rect
        x="13"
        y="13"
        width="15"
        height="15"
        rx="4"
        fill="none"
        class="ink-stroke"
        stroke-width="3"
      />
    </template>
    <template v-else-if="topic === 'integrations'">
      <!-- A page that slots into the frame of a site. -->
      <rect
        x="9"
        y="4"
        width="14"
        height="17"
        rx="3"
        fill="currentColor"
      />
      <path
        d="M4 17v8a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3v-8"
        fill="none"
        class="ink-stroke"
        stroke-width="3"
        stroke-linecap="round"
      />
    </template>
    <template v-else-if="topic === 'store'">
      <!-- Records stacked on records. -->
      <rect
        x="5"
        y="6"
        width="22"
        height="5"
        rx="2.5"
        fill="currentColor"
      />
      <rect
        class="ink"
        x="9"
        y="13.5"
        width="18"
        height="5"
        rx="2.5"
      />
      <rect
        x="5"
        y="21"
        width="22"
        height="5"
        rx="2.5"
        fill="currentColor"
      />
    </template>
    <template v-else-if="topic === 'machine-translation'">
      <!-- A spark, and a smaller one beside it. -->
      <path
        d="M14 4c.8 7 4.9 11.2 12 12-7.1.8-11.2 5-12 12-.8-7-4.9-11.2-12-12 7.1-.8 11.2-5 12-12Z"
        fill="currentColor"
      />
      <circle
        class="ink"
        cx="26"
        cy="6.5"
        r="3"
      />
    </template>
    <template v-else-if="topic === 'workflow'">
      <!-- Two arcs that keep passing the work along. -->
      <path
        d="M5 14a11 11 0 0 1 21-4"
        fill="none"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      <path
        d="M27 18a11 11 0 0 1-21 4"
        fill="none"
        class="ink-stroke"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </template>
    <template v-else-if="topic === 'review-ui'">
      <!-- An eye that reads every line. -->
      <path
        d="M3 16c4.5-7.5 21.5-7.5 26 0-4.5 7.5-21.5 7.5-26 0Z"
        fill="none"
        class="ink-stroke"
        stroke-width="2.5"
      />
      <circle
        cx="16"
        cy="16"
        r="4.5"
        fill="currentColor"
      />
    </template>
    <template v-else>
      <!-- The diglot mark itself. -->
      <path
        d="M15.25 5.03A11 11 0 0 0 15.25 26.97Z"
        fill="currentColor"
      />
      <path
        class="ink"
        d="M16.75 5.03A11 11 0 0 1 16.75 26.97Z"
      />
    </template>
  </svg>
</template>

<style scoped>
.ink {
  fill: var(--mark-ink, var(--ui-text-highlighted));
}

.ink-stroke {
  stroke: var(--mark-ink, var(--ui-text-highlighted));
}
</style>
