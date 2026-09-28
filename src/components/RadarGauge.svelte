<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  let radarWidth = $derived.by(() => {
    if (ble.distance >= 300) return 100;
    return Math.min(100, Math.max(8, (ble.distance / 120) * 100));
  });

  let radarClass = $derived.by(() => {
    if (ble.distance <= 22) return 'radar-fill danger';
    if (ble.distance <= 40) return 'radar-fill warning';
    return 'radar-fill';
  });

  let distLabel = $derived.by(() => {
    if (!ble.ultrasonicEnabled) return 'SENSOR OFF';
    if (ble.distance >= 300) return '>300 cm';
    return `${ble.distance} cm`;
  });
</script>

<div class="radar-box">
  <div class="radar-header">
    <span class="radar-tag">DISTANCE SENSOR</span>
    <span class="radar-dist">{distLabel}</span>
  </div>
  <div class="radar-track">
    <div class={radarClass} style="width: {radarWidth}%;"></div>
  </div>
</div>
