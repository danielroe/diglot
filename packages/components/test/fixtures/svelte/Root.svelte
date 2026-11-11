<script lang="ts">
  import type { Diglot } from "@diglot/components/svelte";
  import type { Component } from "svelte";
  import { setDiglot } from "@diglot/components/svelte";
  let { component: Inner, diglot }: { component: Component; diglot: Diglot } = $props();
  setDiglot(diglot);
</script>

<Inner />
