<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { BLEController } from './lib/ble.svelte';
  import LoadingScreen from './components/LoadingScreen.svelte';
  import RotateNotice from './components/RotateNotice.svelte';
  import TopBar from './components/TopBar.svelte';
  import LeftControls from './components/LeftControls.svelte';
  import CenterPanel from './components/CenterPanel.svelte';
  import RightPanel from './components/RightPanel.svelte';
  import WifiModal from './components/WifiModal.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import FirmwareModal from './components/FirmwareModal.svelte';

  const ble = new BLEController();

  let isSettingsModalOpen = $state(false);
  let isWifiModalOpen = $state(false);
  let isFirmwareModalOpen = $state(false);

  let isAnyModalOpen = $derived(isSettingsModalOpen || isWifiModalOpen || isFirmwareModalOpen);

  function closeAllModals() {
    isSettingsModalOpen = false;
    isWifiModalOpen = false;
    isFirmwareModalOpen = false;
  }

  // Keyboard Shortcuts (WASD / Arrows / Space)
  const keysDown = new Set<string>();

  function computeDirection(): string {
    const up = keysDown.has('KeyW') || keysDown.has('ArrowUp');
    const down = keysDown.has('KeyS') || keysDown.has('ArrowDown');
    const left = keysDown.has('KeyA') || keysDown.has('ArrowLeft');
    const right = keysDown.has('KeyD') || keysDown.has('ArrowRight');

    if (up && left) return 'G';
    if (up && right) return 'I';
    if (down && left) return 'H';
    if (down && right) return 'J';
    if (up) return 'F';
    if (down) return 'B';
    if (left) return 'L';
    if (right) return 'R';
    return 'S';
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }

    if (e.code === 'Space') {
      ble.setDriveMode('MANUAL');
      ble.sendCommand('S', true);
      return;
    }

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      keysDown.add(e.code);
      if (ble.driveMode !== 'MANUAL') ble.setDriveMode('MANUAL');
      ble.sendCommand(computeDirection());
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      keysDown.delete(e.code);
      ble.sendCommand(computeDirection());
    }
  }

  // Gamepad Loop
  let gamepadAnimId: number | null = null;
  let lastGamepadCmd = 'S';

  function pollGamepad() {
    if (typeof navigator !== 'undefined' && 'getGamepads' in navigator) {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];

      if (gp && gp.connected) {
        const axisX = gp.axes[0] || 0;
        const axisY = gp.axes[1] || 0;
        const deadzone = 0.25;

        let cmd = 'S';
        if (Math.abs(axisX) > deadzone || Math.abs(axisY) > deadzone) {
          const normY = -axisY;
          const angle = Math.atan2(normY, axisX) * (180 / Math.PI);
          if (angle >= 67.5 && angle < 112.5) cmd = 'F';
          else if (angle >= 22.5 && angle < 67.5) cmd = 'I';
          else if (angle >= -22.5 && angle < 22.5) cmd = 'R';
          else if (angle >= -67.5 && angle < -22.5) cmd = 'J';
          else if (angle >= -112.5 && angle < -67.5) cmd = 'B';
          else if (angle >= -157.5 && angle < -112.5) cmd = 'H';
          else if (angle >= 112.5 && angle < 157.5) cmd = 'G';
          else cmd = 'L';
        }

        if (cmd !== lastGamepadCmd) {
          lastGamepadCmd = cmd;
          if (ble.driveMode !== 'MANUAL') ble.setDriveMode('MANUAL');
          ble.sendCommand(cmd);
        }
      }
    }
    gamepadAnimId = requestAnimationFrame(pollGamepad);
  }

  function preventDefaults(e: Event) {
    e.preventDefault();
  }

  function handleVisibilityChange() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      ble.requestWakeLock();
    }
  }

  function handleFirstUserInteraction() {
    ble.requestWakeLock();
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('contextmenu', preventDefaults, { passive: false });
    window.addEventListener('selectstart', preventDefaults, { passive: false });
    window.addEventListener('gesturestart', preventDefaults, { passive: false });
    window.addEventListener('pointerdown', handleFirstUserInteraction, { once: true });
    window.addEventListener('touchstart', handleFirstUserInteraction, { once: true, passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Request initial screen wake lock
    ble.requestWakeLock();

    gamepadAnimId = requestAnimationFrame(pollGamepad);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('contextmenu', preventDefaults);
      window.removeEventListener('selectstart', preventDefaults);
      window.removeEventListener('gesturestart', preventDefaults);
      window.removeEventListener('pointerdown', handleFirstUserInteraction);
      window.removeEventListener('touchstart', handleFirstUserInteraction);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    ble.releaseWakeLock();
    if (gamepadAnimId) cancelAnimationFrame(gamepadAnimId);
  });
</script>

<!-- Splash Loading Screen -->
<LoadingScreen />

<!-- Portrait Lock Warning Screen -->
<RotateNotice />

<!-- Main Cockpit Landscape Shell -->
<main class="cockpit-container">
  <!-- Top Telemetry & Header Navigation -->
  <TopBar 
    {ble} 
    onOpenWifi={() => isWifiModalOpen = true}
    onOpenSettings={() => isSettingsModalOpen = true}
  />

  <!-- Three-Column Cockpit Surface -->
  <div class="cockpit-workspace">
    <!-- Left Hand: Touch Joystick, D-Pad, Differential -->
    <LeftControls {ble} />

    <!-- Center: Ultrasonic Radar, Headlights & Horn, Throttle Quadrant -->
    <CenterPanel {ble} />

    <!-- Right Hand: Dead-Reckoning Minimap HUD & Telemetry Logs -->
    <RightPanel {ble} />
  </div>
</main>

<!-- Backdrop Blur -->
{#if isAnyModalOpen}
  <div 
    class="modal-backdrop open" 
    onclick={closeAllModals}
    onkeydown={(e) => e.key === 'Escape' && closeAllModals()}
    role="button"
    tabindex="0"
    aria-label="Close dialog"
  ></div>
{/if}

<!-- Modals -->
<WifiModal 
  {ble} 
  isOpen={isWifiModalOpen} 
  onClose={() => isWifiModalOpen = false} 
/>

<SettingsModal 
  {ble} 
  isOpen={isSettingsModalOpen} 
  onClose={() => isSettingsModalOpen = false}
  onOpenWifi={() => isWifiModalOpen = true}
  onOpenFirmware={() => isFirmwareModalOpen = true}
/>

<FirmwareModal 
  {ble}
  isOpen={isFirmwareModalOpen}
  onClose={() => isFirmwareModalOpen = false}
  onOpenWifi={() => isWifiModalOpen = true}
/>
