<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import { Zap } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  let trackEl: HTMLDivElement | null = $state(null);
  let isDragging = $state(false);
  let activePointerId: number | null = null;

  let speedPct = $derived(Math.round((ble.currentSpeed / 255) * 100));

  const HANDLE_PADDING_PX = 13;

  function updateThrottleFromY(clientY: number) {
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const topBound = rect.top + HANDLE_PADDING_PX;
    const botBound = rect.bottom - HANDLE_PADDING_PX;
    const clampedY = Math.max(topBound, Math.min(botBound, clientY));
    const ratio = (botBound - clampedY) / (botBound - topBound);
    const pwm = Math.round(ratio * 255);
    ble.sendSpeed(pwm);
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    isDragging = true;
    activePointerId = e.pointerId;
    target.setPointerCapture(activePointerId);
    if (trackEl) updateThrottleFromY(e.clientY);
  }

  function onPointerMove(e: PointerEvent) {
    if (isDragging && e.pointerId === activePointerId && trackEl) {
      e.preventDefault();
      updateThrottleFromY(e.clientY);
    }
  }

  function onPointerEnd(e: PointerEvent) {
    if (isDragging && e.pointerId === activePointerId) {
      e.preventDefault();
      isDragging = false;
      activePointerId = null;
    }
  }

  function onTurboDown(e: PointerEvent) {
    e.preventDefault();
    ble.setTurbo(true);
  }

  function onTurboUp(e: PointerEvent) {
    e.preventDefault();
    ble.setTurbo(false);
  }

  function onBrake(e: MouseEvent) {
    e.preventDefault();
    ble.sendSpeed(0);
    ble.sendCommand('S', true);
    ble.vibrate([60, 40, 60]);
    ble.log('🛑 EMERGENCY STOP ACTIVATED', 'error');
  }

  function getThrottleGradient(pct: number): string {
    if (pct < 35) {
      return 'linear-gradient(0deg, #16a34a 0%, #22c55e 100%)';
    } else if (pct < 70) {
      return 'linear-gradient(0deg, #16a34a 0%, #f59e0b 100%)';
    } else {
      return 'linear-gradient(0deg, #16a34a 0%, #f59e0b 50%, #dc2626 100%)';
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="throttle-vertical-container" oncontextmenu={(e) => e.preventDefault()}>
  <!-- Title & Speed Readout -->
  <div class="throttle-title-row">
    <span class="throttle-title-text">
      <span class="cockpit-dot"></span>
      THROTTLE QUADRANT
    </span>
    <span class="pwm-readout {ble.isTurbo ? 'turbo-mode' : ''}">
      {ble.currentSpeed} ({speedPct}%)
    </span>
  </div>

  <!-- Vertical Throttle Body -->
  <div class="throttle-vertical-body">
    
    <!-- 1. 10-Segment VU Meter Column (Aligned 1-to-1 with Throttle Range) -->
    <div class="throttle-vu-meter">
      {#each Array.from({length: 10}) as _, idx}
        {@const segNum = 10 - idx}
        <div class="vu-segment seg-{segNum} {speedPct >= segNum * 10 - 5 ? 'active' : ''}"></div>
      {/each}
    </div>

    <!-- 2. Mechanical Throttle Lever Track -->
    <div 
      class="throttle-lever-track" 
      bind:this={trackEl}
    >
      <div class="lever-track-slot">
        <div class="lever-fill-bar" style="height: {speedPct}%; background: {getThrottleGradient(speedPct)};"></div>
      </div>

      <div class="lever-graduations">
        <span class="grad-mark" data-val="255">255</span>
        <span class="grad-mark" data-val="190">190</span>
        <span class="grad-mark" data-val="128">128</span>
        <span class="grad-mark" data-val="64">64</span>
        <span class="grad-mark" data-val="0">0</span>
      </div>

      <!-- Handle Grip (Positioned via top % offset - Only Handle Initiates Drag) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="throttle-handle {isDragging ? 'dragging' : ''}" 
        style="top: calc({HANDLE_PADDING_PX}px + {(100 - speedPct) / 100} * (100% - {HANDLE_PADDING_PX * 2}px));"
        role="slider"
        aria-label="Throttle Lever Handle"
        aria-valuenow={ble.currentSpeed}
        aria-valuemin={0}
        aria-valuemax={255}
        tabindex="0"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerEnd}
        onpointercancel={onPointerEnd}
      >
        <div class="handle-grip-ribs">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="handle-center-glow"></div>
        <div class="handle-grip-ribs">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>

    <!-- 3. Preset Quick Selection & Turbo Column -->
    <div class="throttle-presets-col">
      <button class="preset-btn" onclick={() => ble.sendSpeed(80)}>
        30%<span class="p-sub">80</span>
      </button>
      <button class="preset-btn" onclick={() => ble.sendSpeed(150)}>
        60%<span class="p-sub">150</span>
      </button>
      <button class="preset-btn" onclick={() => ble.sendSpeed(200)}>
        80%<span class="p-sub">200</span>
      </button>

      <button 
        class="btn-turbo-boost {ble.isTurbo ? 'turbo-active' : ''}" 
        title="Hold for Turbo Boost (255 PWM)"
        onpointerdown={onTurboDown}
        onpointerup={onTurboUp}
        onpointercancel={onTurboUp}
      >
        <Zap size={18} strokeWidth={2.5} class="turbo-bolt" fill="currentColor" />
        <span class="turbo-lbl">TURBO</span>
      </button>
    </div>

  </div>

  <!-- Emergency Brake Button -->
  <button class="emergency-brake-btn" title="Emergency Stop All Motors" onclick={onBrake}>
    <span>STOP</span>
  </button>
</div>
