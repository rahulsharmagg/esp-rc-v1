<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import MinimapCanvas from './MinimapCanvas.svelte';
  import TerminalLog from './TerminalLog.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();
</script>

<section class="panel-right">
  <!-- 150x150 HUD Dead-Reckoning Minimap -->
  <MinimapCanvas {ble} />

  <!-- UART Stream Logger -->
  <TerminalLog {ble} />
</section>
