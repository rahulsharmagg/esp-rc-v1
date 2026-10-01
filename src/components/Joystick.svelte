<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  let baseEl: HTMLDivElement | null = $state(null);
  let stickEl: HTMLDivElement | null = $state(null);
  let activePointerId: number | null = null;
  const maxRadius = 55;

  function processMovement(clientX: number, clientY: number) {
    if (!baseEl || !stickEl) return;
    const rect = baseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    stickEl.style.transform = `translate(${dx}px, ${dy}px)`;

    const normX = dx / maxRadius;
    const normY = -dy / maxRadius;
    const deadzone = 0.25;

    let cmd = 'S';
    if (Math.abs(normX) < deadzone && Math.abs(normY) < deadzone) {
      cmd = 'S';
    } else {
      if (ble.driveMode !== 'MANUAL') {
        ble.setDriveMode('MANUAL');
      }

      const angle = Math.atan2(normY, normX) * (180 / Math.PI);
      if (angle >= 67.5 && angle < 112.5) cmd = 'F';
      else if (angle >= 22.5 && angle < 67.5) cmd = 'I';
      else if (angle >= -22.5 && angle < 22.5) cmd = 'R';
      else if (angle >= -67.5 && angle < -22.5) cmd = 'J';
      else if (angle >= -112.5 && angle < -67.5) cmd = 'B';
      else if (angle >= -157.5 && angle < -112.5) cmd = 'H';
      else if (angle >= 112.5 && angle < 157.5) cmd = 'G';
      else cmd = 'L';
    }

    ble.sendCommand(cmd);
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!baseEl) return;
    activePointerId = e.pointerId;
    try {
      baseEl.setPointerCapture(activePointerId);
    } catch (_) {}
    processMovement(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId === activePointerId) {
      e.preventDefault();
      e.stopPropagation();
      processMovement(e.clientX, e.clientY);
    }
  }

  function onPointerEnd(e: PointerEvent) {
    if (e.pointerId === activePointerId) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (baseEl?.hasPointerCapture?.(e.pointerId)) {
          baseEl.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      activePointerId = null;
      if (stickEl) stickEl.style.transform = 'translate(0px, 0px)';
      ble.sendCommand('S', true);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="joystick-surface" oncontextmenu={(e) => e.preventDefault()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    class="joystick-outer-ring" 
    bind:this={baseEl}
    role="slider"
    aria-label="Directional Joystick"
    aria-valuenow={0}
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
  >
    <div class="cross-h"></div>
    <div class="cross-v"></div>
    <div class="joystick-knob" bind:this={stickEl}>
      <div class="knob-dot"></div>
    </div>
  </div>
</div>
