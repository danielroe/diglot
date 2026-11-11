<script setup>
const items = ["a", "b"];
const ok = true;
</script>
<template>
  <ul>
    <li v-for="item in items" :key="item">Item {{ item }} is ready</li>
  </ul>
  <p>Status: <span v-if="ok">all good</span><span v-else>broken</span></p>
  <template v-if="ok"> Inside a template </template>
  <div>
    Before block
    <div>Inner block</div>
    After block
  </div>
</template>
