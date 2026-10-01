<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import { Lightbulb, Volume2, Compass } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();
  let showServoSlider = $state(false);

  function onHornDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    } catch (_) {}
    ble.setHorn(true);
  }

  function onHornUp(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if ((e.currentTarget as HTMLElement)?.hasPointerCapture?.(e.pointerId)) {
        (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
      }
    } catch (_) {}
    ble.setHorn(false);
  }

  function handleScaleClick(angle: number) {
    ble.setServoAngle(angle);
    ble.vibrate(8);
  }

  function getServoDirectionLabel(angle: number): string {
    if (angle <= 45) return 'RIGHT';
    if (angle >= 135) return 'LEFT';
    if (angle >= 80 && angle <= 100) return 'CENTER';
    if (angle < 80) return 'MID-RIGHT';
    return 'MID-LEFT';
  }

  const scaleMarks = [
    { angle: 0, label: '0°', isMajor: false },
    { angle: 30, label: '30°', isMajor: false },
    { angle: 60, label: '60°', isMajor: false },
    { angle: 90, label: '90°', isMajor: true },
    { angle: 120, label: '120°', isMajor: false },
    { angle: 150, label: '150°', isMajor: false },
    { angle: 180, label: '180°', isMajor: false },
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="actuators-container" oncontextmenu={(e) => e.preventDefault()}>
  <!-- 3-Button Quick Bar -->
  <div class="actuator-quick-bar">
    <!-- Headlights Button -->
    <button 
      type="button"
      class="actuator-btn {ble.isLightsOn ? 'active' : ''}" 
      title="Toggle Headlights"
      onclick={() => ble.toggleLights()}
    >
      <Lightbulb size={13} strokeWidth={2.5} />
      <span>LIGHTS</span>
    </button>

    <!-- Horn Buzzer Button -->
    <button 
      type="button"
      class="actuator-btn {ble.isHornOn ? 'active' : ''}" 
      title="Horn Buzzer (Hold to sound)"
      onpointerdown={onHornDown}
      onpointerup={onHornUp}
      onpointercancel={onHornUp}
    >
      <Volume2 size={13} strokeWidth={2.5} />
      <span>HORN</span>
    </button>

    <!-- Servo Angle Manual Toggle Button -->
    <button 
      type="button"
      class="actuator-btn {showServoSlider ? 'active' : ''}" 
      title="Manual Pan Servo Angle Control"
      onclick={() => showServoSlider = !showServoSlider}
    >
      <Compass size={13} strokeWidth={2.5} />
      <span>SERVO</span>
    </button>
  </div>

  <!-- Collapsible Manual Servo Slider Box with Exact Center-Aligned Horizontal Scale -->
  {#if showServoSlider}
    <div class="servo-slider-box">
      <div class="servo-slider-header">
        <span class="servo-title">PAN SERVO GIMBAL</span>
        <span class="servo-readout">
          <strong>{ble.servoAngle}°</strong> ({getServoDirectionLabel(ble.servoAngle)})
        </span>
      </div>

      <div class="servo-slider-row">
        <input 
          type="range"
          min="0"
          max="180"
          step="1"
          class="servo-range-input"
          value={ble.servoAngle}
          oninput={(e) => ble.setServoAngle(Number((e.target as HTMLInputElement).value))}
        />
      </div>

      <!-- Horizontal Calibration Graduation Scale (Mathematically Aligned to Slider Thumb Centers) -->
      <div class="servo-horizontal-scale">
        {#each scaleMarks as mark}
          <button 
            type="button" 
            class="scale-point {ble.servoAngle === mark.angle ? 'active' : ''}"
            style="left: calc(7px + (100% - 14px) * ({mark.angle} / 180));"
            onclick={() => handleScaleClick(mark.angle)} 
            title="{mark.angle}°"
          >
            <span class="tick-line {mark.isMajor ? 'major' : ''}"></span>
            <span class="tick-lbl {mark.isMajor ? 'major' : ''}">{mark.label}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
