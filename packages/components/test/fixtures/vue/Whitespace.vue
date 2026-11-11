<script setup>
const n = 2;
</script>
<template>
  <div><span>Tight</span><span>words</span></div>
  <div>
    <b>Bold</b>
    <i>italic</i>
  </div>
  <p>lots of spaces</p>
  <span> padded {{ n }} </span>
  <p>a&nbsp;b &amp; c &lt;tag&gt;</p>
  <p>{{ n }} <b>x</b> {{ n }}</p>
</template>
