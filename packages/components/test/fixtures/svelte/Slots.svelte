<script>
  import Card from "./Card.svelte";
  import Icon from "./Icon.svelte";
</script>

<Card title="Card title">
  Card body text
  {#snippet footer()}Footer text{/snippet}
</Card>
<p>Press <Icon /> to close</p>
<div>Go <Card title="Inline card" /> now</div>
