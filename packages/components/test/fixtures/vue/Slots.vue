<script setup>
import Card from "./Card.vue";
import Icon from "./Icon.vue";
</script>
<template>
  <Card title="Card title">
    Card body text
    <template #footer>Footer text</template>
  </Card>
  <p>Press <Icon /> to close</p>
</template>
