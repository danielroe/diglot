<script lang="ts">
  import type { SkeletonNode } from '@diglot/core'
  import type { Snippet } from 'svelte'
  import type { Translator } from './svelte.ts'

  let {
    t,
    h,
    s,
    ...parts
  }: {
    t: Translator
    h: string
    s: string
    [part: `__p${number}`]: Snippet<[Snippet]> | Snippet
  } = $props()

  const nodes = $derived(t.nodes(h, s))
</script>

{#snippet render(list: SkeletonNode[])}
  {#each list as node, i (i)}
    {#if node.type === 'text'}{node.value}{:else if node.type === 'placeholder'}
      {@const part = parts[`__p${node.id}`]}
      {#if part && node.children}
        {@const children = node.children}
        {#snippet wrapped()}{@render render(children)}{/snippet}
        {@render (part as Snippet<[Snippet]>)(wrapped)}
      {:else if part}
        {@render (part as Snippet)()}
      {/if}
    {/if}
  {/each}
{/snippet}

{@render render(nodes)}
