<script setup lang="ts">
const { data: contributors } = await useFetch('/api/contributors', { default: () => [] })
</script>

<template>
  <ul
    v-if="contributors?.length"
    class="my-8 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3"
  >
    <li
      v-for="contributor of contributors"
      :key="contributor.login"
    >
      <a
        :href="contributor.url"
        target="_blank"
        rel="noopener"
        class="landing-card group flex items-center gap-3 p-3"
      >
        <img
          :src="`${contributor.avatarUrl}&s=96`"
          alt=""
          width="40"
          height="40"
          loading="lazy"
          class="size-10 rounded-full"
        >
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted">{{ contributor.login }}</span>
          <span class="block whitespace-nowrap text-xs text-muted">{{ contributor.contributions }} {{ contributor.contributions === 1 ? 'commit' : 'commits' }}</span>
        </span>
      </a>
    </li>
  </ul>
  <p
    v-else
    class="my-8 text-muted"
  >
    The contributor list is unavailable. See the
    <a
      href="https://github.com/danielroe/diglot/graphs/contributors"
      target="_blank"
      rel="noopener"
      class="text-primary underline"
    >contributors on GitHub</a>.
  </p>
</template>
