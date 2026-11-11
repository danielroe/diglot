<script setup>
const href = "/docs";
const name = "Ada";
</script>
<template>
  <p>Read the <a :href="href" class="link">documentation</a> before you <strong>deploy</strong>.</p>
  <p>
    Hi <b>{{ name }}</b
    >, <em>welcome <u>back</u></em
    >!
  </p>
  <p>Line one<br />line two</p>
</template>
