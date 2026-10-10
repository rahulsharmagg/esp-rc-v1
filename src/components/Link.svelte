<script lang="ts">
  import type { Snippet } from 'svelte';
  import { router } from '../lib/router.svelte';

  interface Props {
    href: string;
    class?: string;
    replace?: boolean;
    children?: Snippet;
    [key: string]: any;
  }

  let { href, class: className = '', replace = false, children, ...rest }: Props = $props();

  let isActive = $derived(router.matches(href));

  function handleClick(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    router.navigate(href, { replace });
  }
</script>

<a 
  {href} 
  class="{className} {isActive ? 'active' : ''}" 
  onclick={handleClick}
  {...rest}
>
  {@render children?.()}
</a>
