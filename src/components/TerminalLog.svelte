<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  function clearLogs() {
    ble.logs = [];
    ble.log('Terminal log cleared.', 'info');
  }
</script>

<div class="logs-container">
  <div class="logs-header">
    <div style="display: flex; align-items: center; gap: 4px;">
      <span class="logs-stream-dot"></span>
      <span>TELEMETRY STREAM</span>
    </div>
    <button 
      onclick={clearLogs} 
      title="Clear Log Output"
      style="font-size: 0.5rem; font-family: var(--font-mono); font-weight: 800; padding: 1px 4px; background: #ffffff; border: 1px solid var(--border-dark); cursor: pointer;"
    >
      CLEAR
    </button>
  </div>

  <div class="logs-scroller">
    {#each ble.logs as item (item.id)}
      <div class="log-line {item.type}">
        [{item.timestamp}] {item.message}
      </div>
    {/each}
  </div>
</div>
