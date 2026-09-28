<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import type { ControlMode } from '../lib/types';
  import { Gamepad2, Bot } from '@lucide/svelte';
  import Joystick from './Joystick.svelte';
  import DPad from './DPad.svelte';
  import DifferentialSliders from './DifferentialSliders.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();
  let controlMode = $state<ControlMode>('joystick');

  function selectControlMode(mode: ControlMode) {
    controlMode = mode;
    ble.sendCommand('S', true);
    ble.vibrate(10);
  }
</script>

<section class="panel-left">
  <!-- Mode Selector Header -->
  <div class="drive-mode-bar">
    <button 
      class="mode-switch-btn {ble.driveMode === 'MANUAL' ? 'active' : ''}" 
      onclick={() => ble.setDriveMode('MANUAL')}
    >
      <Gamepad2 size={13} strokeWidth={2.5} />
      <span>MANUAL</span>
    </button>

    <button 
      class="mode-switch-btn {ble.driveMode === 'AUTOMATIC' ? 'active' : ''}" 
      onclick={() => ble.setDriveMode('AUTOMATIC')}
    >
      <Bot size={13} strokeWidth={2.5} />
      <span>AUTO AVOID</span>
    </button>
  </div>

  <!-- Control Mode Sub-tabs -->
  <div class="control-type-tabs">
    <button 
      class="type-tab {controlMode === 'joystick' ? 'active' : ''}" 
      onclick={() => selectControlMode('joystick')}
    >JOYSTICK</button>

    <button 
      class="type-tab {controlMode === 'dpad' ? 'active' : ''}" 
      onclick={() => selectControlMode('dpad')}
    >BUTTONS</button>

    <button 
      class="type-tab {controlMode === 'differential' ? 'active' : ''}" 
      onclick={() => selectControlMode('differential')}
    >DIFFERENTIAL</button>
  </div>

  <!-- Touch Control Viewport -->
  <div class="touch-control-viewport">
    {#if controlMode === 'joystick'}
      <Joystick {ble} />
    {:else if controlMode === 'dpad'}
      <DPad {ble} />
    {:else if controlMode === 'differential'}
      <DifferentialSliders {ble} />
    {/if}
  </div>
</section>
