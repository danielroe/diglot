<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  text: string
  side?: 'left' | 'right'
}>(), { side: 'right' })

const label = useTemplateRef<HTMLElement>('label')
const truncated = ref(false)

function measure() {
  if (!label.value)
    return
  const range = document.createRange()
  range.selectNodeContents(label.value)
  truncated.value = range.getBoundingClientRect().width > label.value.getBoundingClientRect().width
}

let observer: ResizeObserver | undefined

onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(label.value!)
  document.fonts.ready.then(measure)
})

onBeforeUnmount(() => observer?.disconnect())

watch(() => props.text, measure, { flush: 'post' })
</script>

<template>
  <UTooltip
    :text="text"
    :disabled="!truncated"
    :content="{ side }"
    :delay-duration="0"
    :ui="{ content: 'ring-primary' }"
    disable-hoverable-content
  >
    <span
      ref="label"
      v-bind="$attrs"
      class="block truncate"
    >{{ text }}</span>
  </UTooltip>
</template>
