<script setup lang="ts">
const { name, directory, install } = defineProps<{
  /** The package name, such as `@diglot/core`. */
  name: string
  /** The folder of the package in the repository, such as `packages/core`. */
  directory: string
  /** The command shown for installing it. Defaults to `pnpm add <name>`. */
  install?: string
}>()

const command = computed(() => install ?? `pnpm add ${name}`)
const copied = ref(false)

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(command.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  }
  catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="landing-card not-prose my-6 flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left font-mono text-sm text-toned transition-colors hover:text-highlighted"
      :aria-label="`Copy ${command}`"
      @click="copyCommand"
    >
      <span class="text-primary">$</span>
      <span class="truncate">{{ command }}</span>
      <UIcon
        :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        class="ml-auto size-4 shrink-0 text-dimmed"
      />
    </button>
    <span
      class="sr-only"
      aria-live="polite"
    >{{ copied ? 'Copied to the clipboard' : '' }}</span>
    <div class="flex items-center gap-1">
      <UButton
        :to="`https://npmx.dev/package/${name}`"
        target="_blank"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-custom-npmx"
      >
        npmx
      </UButton>
      <UButton
        :to="`https://github.com/danielroe/diglot/tree/main/${directory}`"
        target="_blank"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-simple-icons-github"
      >
        Source
      </UButton>
    </div>
  </div>
</template>
