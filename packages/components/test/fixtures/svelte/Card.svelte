<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, children, footer }: { title?: string; children?: Snippet; footer?: Snippet } = $props();
</script>

<section>
  <h2>{title}</h2>
  {@render children?.()}
  <footer>
    {#if footer}{@render footer()}{:else}Default footer{/if}
  </footer>
</section>
