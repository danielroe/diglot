<script setup>
defineProps({ title: String });
</script>
<template>
  <section>
    <h2>{{ title }}</h2>
    <slot />
    <footer><slot name="footer">Default footer</slot></footer>
  </section>
</template>
