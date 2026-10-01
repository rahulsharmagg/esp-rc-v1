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
    Sun
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    isOpen: boolean;
    onClose: () => void;
    onOpenWifi?: () => void;
    onOpenFirmware?: () => void;
  }

  let { ble, isOpen, onClose, onOpenWifi, onOpenFirmware }: Props = $props();

  let isPurging = $state(false);
  let wasOpen = $state(false);

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
           7. SYSTEM & FIRMWARE UPDATE
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(234, 88, 12, 0.12); color: #ea580c;">
            <ArrowUpCircle size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">SYSTEM UPDATE</span>
        </div>

        <div class="settings-card">
          <div class="settings-row settings-action-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Over-The-Air (OTA) Firmware Update</span>
              <span class="settings-item-sub">
                Installed: <strong>v{ble.currentFirmwareVer}</strong> • Latest: <strong>v{ble.latestFirmwareVer}</strong>
              </span>
            </div>
            <div class="settings-row-right" style="display: flex; align-items: center; gap: 6px;">
              {#if ble.hasFirmwareUpdate}
                <span class="settings-badge danger">UPDATE AVAILABLE</span>
              {:else}
                <span class="settings-badge ok">UP TO DATE</span>
              {/if}
              <button 
                class="test-btn {ble.hasFirmwareUpdate ? 'primary' : ''}" 
                onclick={() => { onClose(); onOpenFirmware?.(); }}
              >
                OPEN UPDATER
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- =================================================================
           8. ABOUT DEVICE
           ================================================================= -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(100, 116, 139, 0.12); color: #475569;">
            <Info size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">ABOUT DEVICE</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Device Name</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-value-mono">ESP32 RC Robot (esp32-robot)</span>
            </div>
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

          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Web Application</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-value-mono">v4.0.0 (Svelte 5 Runes)</span>
            </div>
          </div>

          <div class="settings-row settings-action-row">
            <div class="settings-row-left">
              <span class="settings-item-title" style="font-size: 0.65rem;">Application Storage & Cache</span>
              <span class="settings-item-sub">Purge offline Service Worker cache & hard-reload</span>
            </div>
            <div class="settings-row-right">
              <button class="test-btn" onclick={forceUpdateApp} disabled={isPurging}>
                <RotateCcw size={11} style="margin-right: 3px;" />
                {isPurging ? 'PURGING...' : 'RELOAD PWA'}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button class="test-btn primary" onclick={onClose} style="min-width: 90px;">
        DONE
      </button>
    </div>
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
</style>
