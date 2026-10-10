<script lang="ts">
  import type { Snippet } from 'svelte';
  import { router } from '../lib/router.svelte';

  interface Props {
    path?: string | string[];
    children?: Snippet;
  }

  let { path = '*', children }: Props = $props();

  let isMatch = $derived(router.matches(path));
</script>

{#if isMatch}
  {@render children?.()}
{/if}
