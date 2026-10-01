<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  let leftVal = $state(0);
  let rightVal = $state(0);

  let leftTrackEl: HTMLDivElement | null = $state(null);
  let rightTrackEl: HTMLDivElement | null = $state(null);

  let activeLeftPointer = $state<number | null>(null);
  let activeRightPointer = $state<number | null>(null);

  const HANDLE_PADDING_PX = 13;

  function updateTrackFromY(trackEl: HTMLDivElement, clientY: number): number {
    const rect = trackEl.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const maxTravel = Math.max(10, (rect.height / 2) - HANDLE_PADDING_PX);
    let dy = clientY - centerY;
    dy = Math.max(-maxTravel, Math.min(maxTravel, dy));
    const norm = -dy / maxTravel; // -1 (bottom) to +1 (top)
    return Math.round(norm * 255);
  }

  function syncCommands() {
    if (leftVal === 0 && rightVal === 0) {
      ble.sendCommand('S');
    } else {
      // Mapped so Left Screen Slider = Physical Left Motor, Right Screen Slider = Physical Right Motor
      ble.sendCommand(`D:${rightVal},${leftVal}`);
    }
  }

  function onLeftPointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (ble.driveMode !== 'MANUAL') ble.setDriveMode('MANUAL');
    activeLeftPointer = e.pointerId;
    target.setPointerCapture(activeLeftPointer);
    if (leftTrackEl) {
      leftVal = updateTrackFromY(leftTrackEl, e.clientY);
    }
    ble.vibrate(10);
    syncCommands();
  }

  function onLeftPointerMove(e: PointerEvent) {
    if (activeLeftPointer === e.pointerId && leftTrackEl) {
      e.preventDefault();
      e.stopPropagation();
      leftVal = updateTrackFromY(leftTrackEl, e.clientY);
      syncCommands();
    }
  }

  function onLeftPointerEnd(e: PointerEvent) {
    if (activeLeftPointer === e.pointerId) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if ((e.currentTarget as HTMLElement)?.hasPointerCapture?.(e.pointerId)) {
          (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
        }
      } catch (_) {}
      activeLeftPointer = null;
      leftVal = 0;
      syncCommands();
    }
  }

  function onRightPointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (ble.driveMode !== 'MANUAL') ble.setDriveMode('MANUAL');
    activeRightPointer = e.pointerId;
    try {
      target.setPointerCapture(activeRightPointer);
    } catch (_) {}
    if (rightTrackEl) {
      rightVal = updateTrackFromY(rightTrackEl, e.clientY);
    }
    ble.vibrate(10);
    syncCommands();
  }

  function onRightPointerMove(e: PointerEvent) {
    if (activeRightPointer === e.pointerId && rightTrackEl) {
      e.preventDefault();
      e.stopPropagation();
      rightVal = updateTrackFromY(rightTrackEl, e.clientY);
      syncCommands();
    }
  }

  function onRightPointerEnd(e: PointerEvent) {
    if (activeRightPointer === e.pointerId) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if ((e.currentTarget as HTMLElement)?.hasPointerCapture?.(e.pointerId)) {
          (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
        }
      } catch (_) {}
      activeRightPointer = null;
      rightVal = 0;
      syncCommands();
    }
  }

  function getStatusLabel(val: number): string {
    if (val > 10) return `+${val} PWM`;
    if (val < -10) return `${val} PWM`;
    return '0 (IDLE)';
  }

  function getThrustGradient(val: number): string {
    const abs = Math.abs(val);
    const pct = abs / 255;
    if (val > 0) {
      if (pct < 0.35) {
        return 'linear-gradient(0deg, #16a34a 0%, #22c55e 100%)';
      } else if (pct < 0.7) {
        return 'linear-gradient(0deg, #16a34a 0%, #f59e0b 100%)';
      } else {
        return 'linear-gradient(0deg, #16a34a 0%, #f59e0b 50%, #dc2626 100%)';
      }
    } else if (val < 0) {
      if (pct < 0.35) {
        return 'linear-gradient(180deg, #f59e0b 0%, #ea580c 100%)';
      } else if (pct < 0.7) {
        return 'linear-gradient(180deg, #ea580c 0%, #dc2626 100%)';
      } else {
        return 'linear-gradient(180deg, #f59e0b 0%, #dc2626 60%, #991b1b 100%)';
      }
    }
    return 'transparent';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="diff-quadrant-container" oncontextmenu={(e) => e.preventDefault()}>
  <!-- Header Readout Bar -->
  <div class="diff-title-row">
    <div class="diff-channel-head">
      <span class="channel-title">
        <span class="cockpit-dot"></span>
        LEFT TANK
      </span>
      <span class="diff-pwm-readout {leftVal > 0 ? 'fwd' : leftVal < 0 ? 'rev' : ''}">
        {getStatusLabel(leftVal)}
      </span>
    </div>

    <div class="diff-channel-divider"></div>

    <div class="diff-channel-head">
      <span class="channel-title">
        <span class="cockpit-dot"></span>
        RIGHT TANK
      </span>
      <span class="diff-pwm-readout {rightVal > 0 ? 'fwd' : rightVal < 0 ? 'rev' : ''}">
        {getStatusLabel(rightVal)}
      </span>
    </div>
  </div>

  <!-- Dual Throttle Body -->
  <div class="diff-quadrant-body">
    
    <!-- LEFT MOTOR LEVER TRACK -->
    <div 
      class="diff-lever-column"
      bind:this={leftTrackEl}
    >
      <!-- Lever Slot -->
      <div class="diff-track-slot">
        <!-- Center Neutral Line -->
        <div class="diff-slot-center-line"></div>

        <!-- Dynamic Thrust Fill -->
        {#if leftVal > 0}
          <div 
            class="diff-fill-up" 
            style="height: calc({(leftVal / 255)} * (50% - 6px)); background: {getThrustGradient(leftVal)};"
          ></div>
        {:else if leftVal < 0}
          <div 
            class="diff-fill-down" 
            style="height: calc({(Math.abs(leftVal) / 255)} * (50% - 6px)); background: {getThrustGradient(leftVal)};"
          ></div>
        {/if}
      </div>

      <!-- Graduations -->
      <div class="diff-graduations">
        <span class="diff-grad-mark top-mark" data-val="+255">+255</span>
        <span class="diff-grad-mark" data-val="+128">+128</span>
        <span class="diff-grad-mark center-mark" data-val="0">0</span>
        <span class="diff-grad-mark" data-val="-128">-128</span>
        <span class="diff-grad-mark bot-mark" data-val="-255">-255</span>
      </div>

      <!-- Machined Throttle Handle (Bounded within bar) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="diff-throttle-handle {activeLeftPointer !== null ? 'dragging' : ''}" 
        style="top: calc(50% - {(leftVal / 255)} * (50% - {HANDLE_PADDING_PX}px));"
        role="slider"
        aria-label="Left Motor Throttle Lever Handle"
        aria-valuenow={leftVal}
        aria-valuemin={-255}
        aria-valuemax={255}
        tabindex="0"
        onpointerdown={onLeftPointerDown}
        onpointermove={onLeftPointerMove}
        onpointerup={onLeftPointerEnd}
        onpointercancel={onLeftPointerEnd}
      >
        <div class="handle-grip-ribs">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="handle-center-glow {leftVal > 0 ? 'glow-green' : leftVal < 0 ? 'glow-red' : ''}"></div>
        <div class="handle-grip-ribs">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>

    <!-- SEPARATOR LINE -->
    <div class="diff-bays-sep"></div>

    <!-- RIGHT MOTOR LEVER TRACK -->
    <div 
      class="diff-lever-column"
      bind:this={rightTrackEl}
    >
      <!-- Lever Slot -->
      <div class="diff-track-slot">
        <!-- Center Neutral Line -->
        <div class="diff-slot-center-line"></div>

        <!-- Dynamic Thrust Fill -->
        {#if rightVal > 0}
          <div 
            class="diff-fill-up" 
            style="height: calc({(rightVal / 255)} * (50% - 6px)); background: {getThrustGradient(rightVal)};"
          ></div>
        {:else if rightVal < 0}
          <div 
            class="diff-fill-down" 
            style="height: calc({(Math.abs(rightVal) / 255)} * (50% - 6px)); background: {getThrustGradient(rightVal)};"
          ></div>
        {/if}
      </div>

      <!-- Graduations -->
      <div class="diff-graduations">
        <span class="diff-grad-mark top-mark" data-val="+255">+255</span>
        <span class="diff-grad-mark" data-val="+128">+128</span>
        <span class="diff-grad-mark center-mark" data-val="0">0</span>
        <span class="diff-grad-mark" data-val="-128">-128</span>
        <span class="diff-grad-mark bot-mark" data-val="-255">-255</span>
      </div>

      <!-- Machined Throttle Handle (Bounded within bar) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="diff-throttle-handle {activeRightPointer !== null ? 'dragging' : ''}" 
        style="top: calc(50% - {(rightVal / 255)} * (50% - {HANDLE_PADDING_PX}px));"
        role="slider"
        aria-label="Right Motor Throttle Lever Handle"
        aria-valuenow={rightVal}
        aria-valuemin={-255}
        aria-valuemax={255}
        tabindex="0"
        onpointerdown={onRightPointerDown}
        onpointermove={onRightPointerMove}
        onpointerup={onRightPointerEnd}
        onpointercancel={onRightPointerEnd}
      >
        <div class="handle-grip-ribs">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="handle-center-glow {rightVal > 0 ? 'glow-green' : rightVal < 0 ? 'glow-red' : ''}"></div>
        <div class="handle-grip-ribs">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>

  </div>
</div>
