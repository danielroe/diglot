<script>
  const items = ["a", "b"];
  const ok = true;
  const later = Promise.resolve("done");
</script>

<ul>
  {#each items as item (item)}
    <li>Item {item} is ready</li>
  {:else}
    <li>No items</li>
  {/each}
</ul>
<p>Status: {#if ok}<span>all good</span>{:else}<span>broken</span>{/if}</p>
{#if ok} Inside a block {/if}
<div>
  Before block
  <div>Inner block</div>
  After block
</div>
{#key ok}<p>Keyed text</p>{/key}
{#await later}<p>Loading</p>{:then v}<p>Loaded {v}</p>{/await}
<div>{#each items as item}Label {@const up = item.toUpperCase()} {up} here {/each}</div>
