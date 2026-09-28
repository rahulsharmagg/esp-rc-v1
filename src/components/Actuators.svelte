<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import { Lightbulb, Volume2 } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  function onHornDown(e: PointerEvent) {
    e.preventDefault();
    ble.setHorn(true);
  }

  function onHornUp(e: PointerEvent) {
    e.preventDefault();
    ble.setHorn(false);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="actuator-quick-bar" oncontextmenu={(e) => e.preventDefault()}>
  <!-- Headlights Button -->
  <button 
    class="actuator-btn {ble.isLightsOn ? 'active' : ''}" 
    title="Toggle Headlights"
    onclick={() => ble.toggleLights()}
  >
    <Lightbulb size={15} strokeWidth={2.5} />
    <span>LIGHTS</span>
  </button>

  <!-- Horn Buzzer Button -->
  <button 
    class="actuator-btn {ble.isHornOn ? 'active' : ''}" 
    title="Horn Buzzer (Hold to sound)"
    onpointerdown={onHornDown}
    onpointerup={onHornUp}
    onpointercancel={onHornUp}
  >
    <Volume2 size={15} strokeWidth={2.5} />
    <span>HORN</span>
  </button>
</div>
