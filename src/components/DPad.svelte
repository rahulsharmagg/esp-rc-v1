<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import {
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUpLeft,
    ArrowUpRight,
    ArrowDownLeft,
    ArrowDownRight,
    Square
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  function startCmd(cmd: string, e: PointerEvent) {
    e.preventDefault();
    if (ble.driveMode !== 'MANUAL') ble.setDriveMode('MANUAL');
    ble.sendCommand(cmd, true);
    ble.vibrate(15);
  }

  function stopCmd(e: PointerEvent) {
    e.preventDefault();
    ble.sendCommand('S', true);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dpad-surface" oncontextmenu={(e) => e.preventDefault()}>
  <!-- Top-Left / Diagonal NW -->
  <button 
    class="d-btn diag" 
    onpointerdown={(e) => startCmd('G', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Forward Left"
  >
    <ArrowUpLeft size={16} strokeWidth={2.4} />
  </button>

  <!-- Forward / North -->
  <button 
    class="d-btn card" 
    onpointerdown={(e) => startCmd('F', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Forward"
  >
    <ArrowUp size={20} strokeWidth={2.8} />
  </button>

  <!-- Top-Right / Diagonal NE -->
  <button 
    class="d-btn diag" 
    onpointerdown={(e) => startCmd('I', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Forward Right"
  >
    <ArrowUpRight size={16} strokeWidth={2.4} />
  </button>

  <!-- Spin Left / West -->
  <button 
    class="d-btn card" 
    onpointerdown={(e) => startCmd('L', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Left"
  >
    <ArrowLeft size={20} strokeWidth={2.8} />
  </button>

  <!-- Center Emergency Stop Core -->
  <button 
    class="d-btn stop-core" 
    onpointerdown={(e) => startCmd('S', e)}
    oncontextmenu={(e) => e.preventDefault()}
    title="Emergency Stop"
    aria-label="Emergency Stop"
  >
    <Square size={13} strokeWidth={0} fill="currentColor" />
  </button>

  <!-- Spin Right / East -->
  <button 
    class="d-btn card" 
    onpointerdown={(e) => startCmd('R', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Right"
  >
    <ArrowRight size={20} strokeWidth={2.8} />
  </button>

  <!-- Bottom-Left / Diagonal SW -->
  <button 
    class="d-btn diag" 
    onpointerdown={(e) => startCmd('H', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Reverse Left"
  >
    <ArrowDownLeft size={16} strokeWidth={2.4} />
  </button>

  <!-- Reverse / South -->
  <button 
    class="d-btn card" 
    onpointerdown={(e) => startCmd('B', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Reverse"
  >
    <ArrowDown size={20} strokeWidth={2.8} />
  </button>

  <!-- Bottom-Right / Diagonal SE -->
  <button 
    class="d-btn diag" 
    onpointerdown={(e) => startCmd('J', e)} 
    onpointerup={stopCmd} 
    onpointercancel={stopCmd}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Reverse Right"
  >
    <ArrowDownRight size={16} strokeWidth={2.4} />
  </button>
</div>
