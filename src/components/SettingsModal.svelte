<script lang="ts">
  import { untrack } from 'svelte';
  import type { BLEController } from '../lib/ble.svelte';
  import { 
    X, 
    Wifi, 
    Bluetooth, 
    Activity, 
    BatteryCharging, 
    Vibrate, 
    ArrowUpCircle, 
    RefreshCw, 
    Info, 
    Cpu, 
    CheckCircle2, 
    AlertCircle, 
    Radio, 
    HardDrive,
    Sliders,
    Zap,
    RotateCcw,
    Sun,
    Sparkles,
    DownloadCloud,
    ShieldCheck,
    UploadCloud,
    ChevronDown,
    ChevronUp
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    isOpen: boolean;
    onClose: () => void;
    onOpenWifi?: () => void;
    onOpenFirmware?: () => void;
    onOpenUpload?: () => void;
  }

  let { ble, isOpen, onClose, onOpenWifi, onOpenFirmware, onOpenUpload }: Props = $props();

  let isPurging = $state(false);
  let wasOpen = $state(false);
  let isInstallPromptOpen = $state(false);
  let showAboutDetails = $state(false);

  $effect(() => {
    const currentlyOpen = isOpen;
    if (currentlyOpen && !wasOpen) {
      wasOpen = true;
      untrack(() => {
        ble.checkFirmwareUpdate();
      });
    } else if (!currentlyOpen && wasOpen) {
      wasOpen = false;
    }
  });

  async function forceUpdateApp() {
    isPurging = true;
    ble.log('Purging Service Worker caches and hard-reloading...', 'warn');

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.unregister();
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }

    setTimeout(() => {
      window.location.reload();
    }, 400);
  }
</script>

{#if isOpen}
  <div class="sensor-modal open standard-modal">
    <!-- Header -->
    <div class="modal-header">
      <div class="modal-title-box">
        <span class="modal-tag">SYSTEM</span>
        <h2 class="modal-title">SETTINGS</h2>
      </div>
      <button class="modal-close-btn" onclick={onClose} title="Close Settings">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    <!-- Body / Categories List -->
    <div class="modal-body settings-list-scroll">

      <!-- =================================================================
           1. NETWORK & INTERNET
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(37, 99, 235, 0.12); color: #2563eb;">
            <Wifi size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">NETWORK & INTERNET</span>
        </div>

        <div class="settings-card">
          <!-- Wi-Fi Row -->
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Wi-Fi</span>
              <span class="settings-item-sub">
                {#if !ble.wifi.enabled}
                  Turned off
                {:else if ble.wifi.connected}
                  Connected to <strong style="color: var(--black-solid);">{ble.wifi.ssid}</strong> ({ble.wifi.ip})
                {:else}
                  Turned on (Not connected)
                {/if}
              </span>
            </div>
            <div class="settings-row-right">
              <label class="cyber-switch-wrap" title="Toggle Wi-Fi">
                <input 
                  type="checkbox" 
                  checked={ble.wifi.enabled}
                  onchange={(e) => ble.setWifiPower((e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- Wi-Fi Scanner Action -->
          {#if onOpenWifi}
            <div class="settings-row settings-action-row">
              <div class="settings-row-left">
                <span class="settings-item-title" style="font-size: 0.65rem;">Wi-Fi Networks & Scanner</span>
                <span class="settings-item-sub">Scan available 2.4GHz access points</span>
              </div>
              <div class="settings-row-right">
                <button class="test-btn" onclick={() => { onClose(); onOpenWifi?.(); }}>
                  SCAN NETWORKS
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- =================================================================
           2. CONNECTED DEVICES (BLUETOOTH)
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(14, 165, 233, 0.12); color: #0284c7;">
            <Bluetooth size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">CONNECTED DEVICES</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Bluetooth Low Energy</span>
              <span class="settings-item-sub">Nordic UART Service (UUID: 6E400001...)</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-badge {ble.isConnected ? 'ok' : 'danger'}">
                {ble.isConnected ? 'PAIRED & CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Link Latency / Ping</span>
              <span class="settings-item-sub">Real-time round-trip command delay</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-value-mono">
                {ble.latency > 0 ? `${ble.latency} ms` : '-- ms'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- =================================================================
           3. SENSORS & HARDWARE
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(220, 38, 38, 0.12); color: #dc2626;">
            <Activity size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">SENSORS & HARDWARE</span>
        </div>

        <div class="settings-card">
          <!-- 1. Ultrasonic Ranger -->
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Ultrasonic Distance Ranger</span>
              <span class="settings-item-sub">HC-SR04 • Trigger: GPIO 18 | Echo: GPIO 19</span>
            </div>
            <div class="settings-row-right" style="display: flex; align-items: center; gap: 8px;">
              <span class="settings-value-pill {ble.ultrasonicEnabled ? (ble.distance <= 22 ? 'danger' : 'ok') : 'disabled'}">
                {ble.ultrasonicEnabled ? (ble.distance >= 300 ? '>300 cm' : `${ble.distance} cm`) : 'OFF'}
              </span>
              <label class="cyber-switch-wrap" title="Toggle Ultrasonic Ranger">
                <input 
                  type="checkbox" 
                  checked={ble.ultrasonicEnabled}
                  onchange={(e) => ble.setSensorEnabled('ultrasonic', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- 2. Left IR Sensor -->
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Left Proximity Sensor</span>
              <span class="settings-item-sub">TCRT5000 IR Sensor • GPIO 34</span>
            </div>
            <div class="settings-row-right" style="display: flex; align-items: center; gap: 8px;">
              <span class="settings-value-pill {ble.irLeftEnabled ? (ble.irLeft ? 'danger' : 'ok') : 'disabled'}">
                {ble.irLeftEnabled ? (ble.irLeft ? 'BLOCKED' : 'CLEAR') : 'OFF'}
              </span>
              <label class="cyber-switch-wrap" title="Toggle Left IR Sensor">
                <input 
                  type="checkbox" 
                  checked={ble.irLeftEnabled}
                  onchange={(e) => ble.setSensorEnabled('irLeft', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- 3. Right IR Sensor -->
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Right Proximity Sensor</span>
              <span class="settings-item-sub">TCRT5000 IR Sensor • GPIO 35</span>
            </div>
            <div class="settings-row-right" style="display: flex; align-items: center; gap: 8px;">
              <span class="settings-value-pill {ble.irRightEnabled ? (ble.irRight ? 'danger' : 'ok') : 'disabled'}">
                {ble.irRightEnabled ? (ble.irRight ? 'BLOCKED' : 'CLEAR') : 'OFF'}
              </span>
              <label class="cyber-switch-wrap" title="Toggle Right IR Sensor">
                <input 
                  type="checkbox" 
                  checked={ble.irRightEnabled}
                  onchange={(e) => ble.setSensorEnabled('irRight', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- 4. Pan Servo Gimbal -->
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Radar Pan Gimbal</span>
              <span class="settings-item-sub">SG90 Micro Servo PWM • GPIO 5</span>
            </div>
            <div class="settings-row-right" style="display: flex; align-items: center; gap: 8px;">
              <span class="settings-value-pill {ble.servoEnabled ? 'ok' : 'disabled'}">
                {ble.servoEnabled ? `${ble.servoAngle}°` : 'OFF'}
              </span>
              <label class="cyber-switch-wrap" title="Toggle Servo Gimbal">
                <input 
                  type="checkbox" 
                  checked={ble.servoEnabled}
                  onchange={(e) => ble.setSensorEnabled('servo', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- =================================================================
           4. BATTERY & POWER
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(22, 163, 74, 0.12); color: #16a34a;">
            <BatteryCharging size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">BATTERY & POWER</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">
                {ble.hasBattery ? 'Charge Level & Voltage' : 'Power Source / Battery Status'}
              </span>
              <span class="settings-item-sub">
                {ble.hasBattery 
                  ? '2S Li-ion Power Pack (7.4V Nominal / 8.4V Max)' 
                  : 'USB 5V / External Power (No battery voltage divider connected)'}
              </span>
            </div>
            <div class="settings-row-right" style="text-align: right;">
              <div style="font-size: 0.75rem; font-weight: 800; font-family: var(--font-mono); color: {ble.hasBattery ? 'var(--black-solid)' : '#64748b'};">
                {ble.hasBattery ? `${ble.batteryPct}%` : 'NO BATTERY'}
              </div>
              <div style="font-size: 0.58rem; color: #71717a; font-family: var(--font-mono);">
                {ble.hasBattery ? `${ble.batteryVolts.toFixed(2)} V` : 'USB 5.0V / UNMONITORED'}
              </div>
            </div>
          </div>

          {#if ble.hasBattery}
            <div style="padding: 0 10px 10px 10px;">
              <div style="width: 100%; height: 6px; background: rgba(0,0,0,0.08); border-radius: 3px; overflow: hidden;">
                <div 
                  style="width: {Math.max(5, Math.min(100, ble.batteryPct))}%; height: 100%; background: {ble.batteryPct <= 20 ? '#ef4444' : (ble.batteryPct <= 50 ? '#eab308' : '#22c55e')}; transition: width 0.3s ease;"
                ></div>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- =================================================================
           5. DISPLAY & SCREEN TIMEOUT
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(234, 179, 8, 0.12); color: #ca8a04;">
            <Sun size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">DISPLAY & SCREEN TIMEOUT</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Keep Screen Awake (Always-On)</span>
              <span class="settings-item-sub">Prevent mobile display from sleeping, dimming, or auto-locking</span>
            </div>
            <div class="settings-row-right" style="display: flex; align-items: center; gap: 8px;">
              <span class="settings-value-pill {ble.wakeLockActive ? 'ok' : (ble.wakeLockEnabled ? 'ok' : 'disabled')}">
                {ble.wakeLockActive ? 'ACTIVE' : (ble.wakeLockEnabled ? 'ARMED' : 'OFF')}
              </span>
              <label class="cyber-switch-wrap" title="Toggle Keep Screen Awake">
                <input 
                  type="checkbox" 
                  checked={ble.wakeLockEnabled}
                  onchange={(e) => ble.setWakeLock((e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- =================================================================
           6. SOUND & HAPTICS
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(168, 85, 247, 0.12); color: #9333ea;">
            <Vibrate size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">SOUND & HAPTICS</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Haptic Touch Vibration</span>
              <span class="settings-item-sub">Vibrate device on button taps, steering, and commands</span>
            </div>
            <div class="settings-row-right">
              <label class="cyber-switch-wrap" title="Toggle Haptic Feedback">
                <input 
                  type="checkbox" 
                  checked={ble.hapticEnabled}
                  onchange={(e) => ble.setHaptic((e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- =================================================================
           7. ABOUT SYSTEM (WITH COLLAPSIBLE "V" ACCORDION)
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="settings-icon-chip" style="background: rgba(100, 116, 139, 0.12); color: #475569;">
              <Info size={14} strokeWidth={2.5} />
            </div>
            <span class="settings-group-title">ABOUT SYSTEM</span>
          </div>

          <!-- Accordion Toggle Button ("V" / Chevron) -->
          <button 
            type="button" 
            class="btn-accordion-toggle"
            class:active={showAboutDetails}
            onclick={() => showAboutDetails = !showAboutDetails}
            title={showAboutDetails ? 'Hide system information' : 'Show system information'}
            aria-expanded={showAboutDetails}
          >
            <span class="accordion-lbl">{showAboutDetails ? 'HIDE INFO' : 'SHOW INFO'}</span>
            <div class="accordion-chevron-box">
              {#if showAboutDetails}
                <ChevronUp size={13} strokeWidth={2.5} />
              {:else}
                <ChevronDown size={13} strokeWidth={2.5} />
              {/if}
            </div>
          </button>
        </div>

        <div class="settings-card">
          <!-- Always Visible: Quick Overview -->
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Device &amp; Controller</span>
              <span class="settings-item-sub">ESP32 RC Robot (esp32-robot)</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-badge ok">{ble.isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Web Cockpit Version</span>
              <span class="settings-item-sub">Svelte 5 Runes &amp; Web Bluetooth API</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-value-mono">v4.0.0</span>
            </div>
          </div>

          <!-- Collapsible Extended Information -->
          {#if showAboutDetails}
            <!-- 1. Hardware Specifications -->
            <div class="settings-sub-header">
              <Cpu size={12} strokeWidth={2.5} class="text-muted" />
              <span>HARDWARE SPECIFICATIONS</span>
            </div>

            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Microcontroller</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-value-mono">ESP32 DevKit Core 3.x (240MHz)</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Motor Driver</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-value-mono">L298N Dual H-Bridge (20kHz PWM)</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Operating Mode</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-badge ok">{ble.driveMode}</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Hardware Uptime</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-value-mono">{ble.uptime}</span>
              </div>
            </div>

            <!-- 2. System & Firmware Update -->
            <div class="settings-sub-header">
              <ArrowUpCircle size={12} strokeWidth={2.5} style="color: #ea580c;" />
              <span>SYSTEM &amp; FIRMWARE UPDATE</span>
            </div>

            <div class="settings-row settings-action-row">
              <div class="settings-row-left">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="settings-item-title">Over-The-Air Update</span>
                  {#if ble.hasFirmwareUpdate}
                    <span class="settings-badge danger">UPDATE AVAILABLE</span>
                  {:else}
                    <span class="settings-badge ok">UP TO DATE</span>
                  {/if}
                </div>
                <span class="settings-item-sub">
                  Installed: <strong>v{ble.currentFirmwareVer}</strong> • Latest: <strong>v{ble.latestFirmwareVer}</strong>
                </span>
              </div>
              <div class="settings-row-right">
                <button 
                  type="button"
                  class="test-btn" 
                  onclick={() => ble.checkFirmwareUpdate()}
                  disabled={ble.isCheckingFirmware}
                  title="Check latest releases from server"
                >
                  <RefreshCw size={11} class={ble.isCheckingFirmware ? 'animate-spin' : ''} style="margin-right: 3px;" />
                  {ble.isCheckingFirmware ? 'CHECKING...' : 'CHECK FOR UPDATE'}
                </button>
              </div>
            </div>

            {#if ble.hasFirmwareUpdate}
              <div class="new-version-box">
                <div class="settings-row-left">
                  <div style="display: flex; align-items: center; gap: 5px;">
                    <Sparkles size={13} color="#ea580c" />
                    <span class="settings-item-title" style="color: #c2410c; font-weight: 800;">
                      New Version: v{ble.latestFirmwareVer}
                    </span>
                  </div>
                  {#if ble.latestFirmwareDescription}
                    <div class="new-version-feature-text font-mono">
                      {ble.latestFirmwareDescription}
                    </div>
                  {:else}
                    <span class="settings-item-sub">
                      An updated release is ready for Over-The-Air installation.
                    </span>
                  {/if}
                </div>
                <div class="settings-row-right">
                  <button 
                    type="button"
                    class="test-btn primary" 
                    style="background: #ea580c; color: #ffffff; border-color: #c2410c; font-weight: 800; min-width: 85px;"
                    onclick={() => isInstallPromptOpen = true}
                  >
                    <ArrowUpCircle size={12} style="margin-right: 3px;" />
                    UPDATE
                  </button>
                </div>
              </div>
            {/if}

            <!-- 3. Application Restart & Cache -->
            <div class="settings-sub-header">
              <RotateCcw size={12} strokeWidth={2.5} class="text-muted" />
              <span>APPLICATION MAINTENANCE</span>
            </div>

            <div class="settings-row settings-action-row">
              <div class="settings-row-left">
                <span class="settings-item-title" style="font-size: 0.65rem;">Restart Application</span>
                <span class="settings-item-sub">Purge offline Service Worker cache &amp; restart web cockpit</span>
              </div>
              <div class="settings-row-right">
                <button type="button" class="test-btn" onclick={forceUpdateApp} disabled={isPurging}>
                  <RotateCcw size={11} class={isPurging ? 'animate-spin' : ''} style="margin-right: 3px;" />
                  {isPurging ? 'PURGING...' : 'RESTART APPLICATION'}
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- =================================================================
           8. FIRMWARE DISPATCH / DEVELOPER PORTAL (SEPARATE SECTION)
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(234, 88, 12, 0.12); color: #ea580c;">
            <UploadCloud size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">FIRMWARE DISPATCH TERMINAL</span>
        </div>

        <div class="settings-card">
          <div class="settings-row settings-action-row">
            <div class="settings-row-left">
              <span class="settings-item-title" style="font-size: 0.65rem;">Firmware Release Portal</span>
              <span class="settings-item-sub">Publish compiled .bin firmware images directly to server storage</span>
            </div>
            <div class="settings-row-right">
              <button type="button" class="test-btn primary" onclick={() => { onClose(); onOpenUpload?.(); }}>
                <UploadCloud size={11} style="margin-right: 3px;" />
                UPLOAD PORTAL
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button type="button" class="test-btn primary" onclick={onClose} style="min-width: 90px;">
        DONE
      </button>
    </div>

    <!-- =================================================================
         INSTALL OVERLAY DIALOG (Appears over current window on UPDATE click)
         ================================================================= -->
    {#if isInstallPromptOpen}
      <div 
        class="nested-modal-backdrop" 
        onclick={() => { if (ble.otaStatus !== 'UPDATING') isInstallPromptOpen = false; }}
        onkeydown={(e) => { if (e.key === 'Escape' && ble.otaStatus !== 'UPDATING') isInstallPromptOpen = false; }}
        role="button"
        tabindex="0"
        aria-label="Close installation dialog"
      >
        <div 
          class="nested-modal-dialog" 
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="dialog"
          tabindex="-1"
          aria-modal="true"
          aria-labelledby="nested-install-title"
        >
          <!-- Nested Header -->
          <div class="nested-modal-header">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="modal-tag" style="background: #ea580c; color: #ffffff;">OTA UPDATE</span>
              <h3 id="nested-install-title" class="nested-modal-title">FIRMWARE INSTALLATION</h3>
            </div>
            {#if ble.otaStatus !== 'UPDATING'}
              <button 
                type="button"
                class="modal-close-btn" 
                onclick={() => isInstallPromptOpen = false} 
                title="Close"
              >
                <X size={14} />
              </button>
            {/if}
          </div>

          <!-- Nested Body -->
          <div class="nested-modal-body">
            <!-- Version Comparison Card -->
            <div class="install-version-card">
              <div class="ver-col">
                <span class="ver-lbl">CURRENT INSTALLED</span>
                <span class="ver-val">v{ble.currentFirmwareVer}</span>
              </div>
              <div class="ver-arrow">➔</div>
              <div class="ver-col">
                <span class="ver-lbl" style="color: #ea580c;">TARGET RELEASE</span>
                <span class="ver-val target">v{ble.latestFirmwareVer}</span>
              </div>
            </div>

            {#if ble.latestFirmwareDescription}
              <div class="install-feature-notes">
                <div class="feature-notes-header">
                  <Sparkles size={11} color="#ea580c" />
                  <span class="feature-notes-lbl">WHAT'S NEW IN THIS VERSION:</span>
                </div>
                <div class="feature-notes-text font-mono">{ble.latestFirmwareDescription}</div>
              </div>
            {/if}

            <!-- Wi-Fi Status Check Card -->
            <div class="install-status-card {ble.wifi.connected ? 'ready' : 'warning'}">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="status-icon-wrap">
                  {#if ble.wifi.connected}
                    <Wifi size={16} color="#16a34a" />
                  {:else}
                    <AlertCircle size={16} color="#d97706" />
                  {/if}
                </div>
                <div>
                  <div class="status-heading">
                    {ble.wifi.connected ? `Wi-Fi Connected (${ble.wifi.ssid})` : 'ESP32 Wi-Fi Not Connected'}
                  </div>
                  <div class="status-detail">
                    {ble.wifi.connected 
                      ? `IP: ${ble.wifi.ip} • Ready to download and flash binary.` 
                      : 'Connecting to Wi-Fi is required. Clicking Install will open Wi-Fi network scanner.'}
                  </div>
                </div>
              </div>
            </div>

            <!-- Live OTA Progress Bar if Updating -->
            {#if ble.otaStatus === 'UPDATING'}
              <div class="ota-live-box">
                <div class="ota-live-header">
                  <span style="color: #60a5fa; font-weight: 700;">FLASHING TO ESP32...</span>
                  <span>{ble.otaProgress}%</span>
                </div>
                <div class="ota-live-bar">
                  <div class="ota-live-bar-fill" style="width: {ble.otaProgress}%;"></div>
                </div>
                <div class="ota-live-msg">
                  {ble.otaMessage || 'Streaming binary chunks over Wi-Fi...'}
                </div>
                {#if !ble.isConnected}
                  <div style="margin-top: 8px; text-align: right;">
                    <button 
                      type="button"
                      class="test-btn primary" 
                      onclick={() => ble.connect()}
                      style="background: #2563eb; color: #ffffff;"
                    >
                      <RotateCcw size={11} style="margin-right: 3px;" />
                      RECONNECT BLUETOOTH
                    </button>
                  </div>
                {/if}
              </div>
            {:else if ble.otaStatus === 'SUCCESS'}
              <div class="ota-alert-box success">
                <CheckCircle2 size={15} color="#16a34a" />
                <span>{ble.otaMessage || 'Firmware update completed successfully!'}</span>
              </div>
            {:else if ble.otaStatus === 'ERROR'}
              <div class="ota-alert-box error">
                <AlertCircle size={15} color="#dc2626" />
                <span>{ble.otaMessage || 'Firmware installation failed.'}</span>
              </div>
            {/if}
          </div>

          <!-- Nested Footer -->
          <div class="nested-modal-footer">
            <button 
              type="button" 
              class="test-btn" 
              onclick={() => isInstallPromptOpen = false}
              disabled={ble.otaStatus === 'UPDATING'}
            >
              CANCEL
            </button>
            <button 
              type="button" 
              class="test-btn primary"
              style="background: #ea580c; color: #ffffff; border-color: #c2410c; font-weight: 800; min-width: 110px;"
              disabled={ble.otaStatus === 'UPDATING'}
              onclick={() => {
                if (ble.wifi.connected) {
                  ble.startFirmwareUpdate(ble.latestFirmwareVer);
                } else {
                  onOpenWifi?.();
                }
              }}
            >
              <DownloadCloud size={13} style="margin-right: 3px;" />
              {ble.otaStatus === 'UPDATING' ? 'INSTALLING...' : 'INSTALL'}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .settings-list-scroll {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px 14px;
    overflow-y: auto;
    background: #ffffff;
  }

  .settings-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e2e8f0;
  }

  .settings-group:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .settings-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0 4px 0;
  }

  .settings-icon-chip {
    width: 18px;
    height: 18px;
    border-radius: 0px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent !important;
  }

  .settings-group-title {
    font-size: 0.64rem;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: #334155;
    font-family: var(--font-mono, monospace);
  }

  /* Accordion Toggle "V" Button */
  .btn-accordion-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
    padding: 2px 6px;
    cursor: pointer;
    transition: all 0.12s ease;
    font-family: var(--font-mono, monospace);
  }

  .btn-accordion-toggle:hover {
    background: #090d16;
    border-color: #090d16;
    color: #ffffff;
  }

  .btn-accordion-toggle.active {
    background: #1e293b;
    border-color: #334155;
    color: #f8fafc;
  }

  .accordion-lbl {
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.4px;
  }

  .accordion-chevron-box {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-sub-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 0 3px 0;
    margin-top: 4px;
    font-size: 0.58rem;
    font-weight: 800;
    color: #64748b;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.5px;
    border-bottom: 1px dashed #e2e8f0;
  }

  .settings-card {
    background: transparent;
    border: none;
    border-radius: 0px;
    box-shadow: none;
    display: flex;
    flex-direction: column;
  }

  .settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px solid #f1f5f9;
    gap: 8px;
  }

  .settings-row:last-child {
    border-bottom: none;
  }

  .settings-row-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .settings-item-title {
    font-size: 0.7rem;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
  }

  .settings-item-sub {
    font-size: 0.58rem;
    color: #64748b;
    font-family: var(--font-mono, monospace);
    line-height: 1.2;
  }

  .settings-row-right {
    flex-shrink: 0;
  }

  .settings-badge {
    font-size: 0.58rem;
    font-weight: 800;
    font-family: var(--font-mono, monospace);
    padding: 2px 6px;
    border-radius: 0px;
    letter-spacing: 0.3px;
    display: inline-block;
  }

  .settings-badge.ok {
    background: rgba(34, 197, 94, 0.12);
    color: #16a34a;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .settings-badge.danger {
    background: rgba(239, 68, 68, 0.12);
    color: #dc2626;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .settings-value-mono {
    font-size: 0.65rem;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    color: #334155;
  }

  .settings-value-pill {
    font-size: 0.58rem;
    font-family: var(--font-mono, monospace);
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 0px;
  }

  .settings-value-pill.ok {
    background: rgba(34, 197, 94, 0.12);
    color: #16a34a;
  }

  .settings-value-pill.danger {
    background: rgba(239, 68, 68, 0.12);
    color: #dc2626;
  }

  .settings-value-pill.disabled {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }

  .settings-action-row {
    background: transparent;
  }

  /* Redesigned New Version Attachment Box */
  .new-version-box {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    margin-top: 6px;
    background: rgba(234, 88, 12, 0.05);
    border: 1.5px solid rgba(234, 88, 12, 0.4);
    border-radius: 0px;
    gap: 8px;
    animation: fadeIn 0.2s ease-in-out;
  }

  .new-version-feature-text {
    font-size: 0.58rem;
    color: #9a3412;
    line-height: 1.35;
    background: rgba(234, 88, 12, 0.08);
    border-left: 2px solid #ea580c;
    padding: 3px 6px;
    margin-top: 3px;
    word-break: break-word;
  }

  /* Feature Notes inside Install Dialog */
  .install-feature-notes {
    padding: 8px 10px;
    background: #ffffff;
    border: 1.5px solid #fed7aa;
    border-left: 3px solid #ea580c;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .feature-notes-header {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .feature-notes-lbl {
    font-size: 0.54rem;
    font-weight: 800;
    color: #c2410c;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.5px;
  }

  .feature-notes-text {
    font-size: 0.62rem;
    color: #334155;
    line-height: 1.35;
    word-break: break-word;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Over-window Nested Modal Overlay */
  .nested-modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(10, 14, 23, 0.75);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    animation: fadeIn 0.2s ease-out;
  }

  .nested-modal-dialog {
    width: 100%;
    max-width: 440px;
    background: #ffffff;
    border: 2px solid var(--black-solid);
    box-shadow: 6px 6px 0px #ea580c, 0 20px 25px -5px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .nested-modal-header {
    height: 38px;
    background: var(--black-solid);
    color: #ffffff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
  }

  .nested-modal-title {
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.8px;
    font-family: var(--font-mono, monospace);
  }

  .nested-modal-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: #fafafa;
  }

  .nested-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 14px;
    background: #f1f5f9;
    border-top: 1.5px solid #e2e8f0;
  }

  /* Version Comparison Card */
  .install-version-card {
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 10px;
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 0px;
  }

  .ver-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .ver-lbl {
    font-size: 0.52rem;
    font-weight: 800;
    color: #64748b;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.5px;
  }

  .ver-val {
    font-size: 0.85rem;
    font-weight: 900;
    font-family: var(--font-mono, monospace);
    color: #0f172a;
  }

  .ver-val.target {
    color: #ea580c;
  }

  .ver-arrow {
    font-size: 1rem;
    color: #94a3b8;
    font-weight: 900;
  }

  /* Network Status Card */
  .install-status-card {
    padding: 8px 10px;
    border-radius: 0px;
    border: 1.5px solid #e2e8f0;
    background: #ffffff;
  }

  .install-status-card.ready {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.04);
  }

  .install-status-card.warning {
    border-color: rgba(217, 119, 6, 0.4);
    background: rgba(217, 119, 6, 0.04);
  }

  .status-icon-wrap {
    flex-shrink: 0;
  }

  .status-heading {
    font-size: 0.68rem;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.2;
    font-family: var(--font-mono, monospace);
  }

  .status-detail {
    font-size: 0.56rem;
    color: #64748b;
    font-family: var(--font-mono, monospace);
    line-height: 1.2;
    margin-top: 2px;
  }

  /* Live OTA Progress */
  .ota-live-box {
    padding: 10px;
    background: #18181b;
    color: #ffffff;
    border-radius: 0px;
  }

  .ota-live-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.62rem;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    margin-bottom: 5px;
  }

  .ota-live-bar {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.15);
    overflow: hidden;
  }

  .ota-live-bar-fill {
    height: 100%;
    background: #3b82f6;
    transition: width 0.3s ease;
  }

  .ota-live-msg {
    font-size: 0.55rem;
    color: #a1a1aa;
    margin-top: 4px;
    font-family: var(--font-mono, monospace);
  }

  /* Alerts */
  .ota-alert-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    font-size: 0.62rem;
    font-weight: 700;
    font-family: var(--font-mono, monospace);
  }

  .ota-alert-box.success {
    background: #f0fdf4;
    border: 1px solid #22c55e;
    color: #16a34a;
  }

  .ota-alert-box.error {
    background: #fef2f2;
    border: 1px solid #ef4444;
    color: #dc2626;
  }
</style>
