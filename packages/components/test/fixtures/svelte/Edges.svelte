<script>
  import Card from "./Card.svelte";
  const n = 3;
  const tag = "em";
</script>

<svelte:head><title>Page title</title></svelte:head>
<div>Hello <!-- c --> <div>block</div> <!-- d --> bye</div>
<p>
  {n}
  items left,
  {n} done
</p>
<select><option>One</option> <option>Two</option></select>
<Card>Body {#snippet footer()}Foot{/snippet} more</Card>
<p>Say <svelte:element this={tag}>dynamic</svelte:element> words</p>
<p>× {n} ×</p>
<p>Mixed {@html "<i>raw</i>"}<b>bold</b> end</p>
