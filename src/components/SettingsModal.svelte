<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import { X, Activity } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    isOpen: boolean;
    onClose: () => void;
    onOpenWifi?: () => void;
  }

  let { ble, isOpen, onClose, onOpenWifi }: Props = $props();

  let isPurging = $state(false);

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
  <div class="sensor-modal open">
    <div class="modal-header">
      <div class="modal-title-box">
        <span class="modal-tag">SETTINGS</span>
        <h2 class="modal-title">SYSTEM SETTINGS & SENSOR CONFIGURATION</h2>
      </div>
      <button class="modal-close-btn" onclick={onClose} title="Close Settings">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    <div class="modal-body">
      
      <!-- =================================================================
           SECTION 1: HARDWARE SENSORS & ON/OFF TOGGLES
           ================================================================= -->
      <div class="sensor-diag-card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <div class="card-name-group">
            <div style="display: flex; align-items: center; gap: 6px;">
              <Activity size={15} color="#dc2626" strokeWidth={2.5} />
              <span class="sensor-name">HARDWARE SENSORS (ENABLE / DISABLE)</span>
            </div>
            <span class="sensor-pin">Real-time peripheral power and signal processing</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-top: 4px;">
          
          <!-- 1. Ultrasonic HC-SR04 Toggle -->
          <div class="card-metric-row" style="flex-direction: column; align-items: stretch; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="sensor-name" style="font-size: 0.68rem;">ULTRASONIC RANGER</span>
                <span class="sensor-pin" style="display: block;">HC-SR04 • GPIO 13/12</span>
              </div>
              <label class="cyber-switch-wrap" title="Toggle Ultrasonic Ranger">
                <input 
                  type="checkbox" 
                  checked={ble.ultrasonicEnabled}
                  onchange={(e) => ble.setSensorEnabled('ultrasonic', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.58rem; font-family: var(--font-mono);">
              <span class="metric-label">READING:</span>
              <span class="sensor-val {ble.ultrasonicEnabled ? (ble.distance <= 22 ? 'danger' : 'ok') : 'disabled'}">
                {ble.ultrasonicEnabled ? (ble.distance >= 300 ? '>300 cm' : `${ble.distance} cm`) : 'DISABLED'}
              </span>
            </div>
          </div>

          <!-- 2. Left IR TCRT5000 Toggle -->
          <div class="card-metric-row" style="flex-direction: column; align-items: stretch; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="sensor-name" style="font-size: 0.68rem;">LEFT IR PROXIMITY</span>
                <span class="sensor-pin" style="display: block;">TCRT5000 • GPIO 34</span>
              </div>
              <label class="cyber-switch-wrap" title="Toggle Left IR Sensor">
                <input 
                  type="checkbox" 
                  checked={ble.irLeftEnabled}
                  onchange={(e) => ble.setSensorEnabled('irLeft', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.58rem; font-family: var(--font-mono);">
              <span class="metric-label">STATUS:</span>
              <span class="sensor-val {ble.irLeftEnabled ? (ble.irLeft ? 'danger' : 'ok') : 'disabled'}">
                {ble.irLeftEnabled ? (ble.irLeft ? 'BLOCKED' : 'CLEAR') : 'DISABLED'}
              </span>
            </div>
          </div>

          <!-- 3. Right IR TCRT5000 Toggle -->
          <div class="card-metric-row" style="flex-direction: column; align-items: stretch; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="sensor-name" style="font-size: 0.68rem;">RIGHT IR PROXIMITY</span>
                <span class="sensor-pin" style="display: block;">TCRT5000 • GPIO 35</span>
              </div>
              <label class="cyber-switch-wrap" title="Toggle Right IR Sensor">
                <input 
                  type="checkbox" 
                  checked={ble.irRightEnabled}
                  onchange={(e) => ble.setSensorEnabled('irRight', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.58rem; font-family: var(--font-mono);">
              <span class="metric-label">STATUS:</span>
              <span class="sensor-val {ble.irRightEnabled ? (ble.irRight ? 'danger' : 'ok') : 'disabled'}">
                {ble.irRightEnabled ? (ble.irRight ? 'BLOCKED' : 'CLEAR') : 'DISABLED'}
              </span>
            </div>
          </div>

          <!-- 4. SG90 Servo Gimbal Toggle -->
          <div class="card-metric-row" style="flex-direction: column; align-items: stretch; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="sensor-name" style="font-size: 0.68rem;">RADAR SERVO GIMBAL</span>
                <span class="sensor-pin" style="display: block;">SG90 PWM • GPIO 27</span>
              </div>
              <label class="cyber-switch-wrap" title="Toggle Servo Radar Gimbal">
                <input 
                  type="checkbox" 
                  checked={ble.servoEnabled}
                  onchange={(e) => ble.setSensorEnabled('servo', (e.target as HTMLInputElement).checked)}
                >
                <span class="switch-slider"></span>
              </label>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.58rem; font-family: var(--font-mono);">
              <span class="metric-label">ANGLE:</span>
              <span class="sensor-val {ble.servoEnabled ? 'ok' : 'disabled'}">
                {ble.servoEnabled ? `${ble.servoAngle}° CENTER` : 'DISABLED'}
              </span>
            </div>
          </div>

        </div>
      </div>

      <!-- =================================================================
           SECTION 2: BATTERY TELEMETRY & HEALTH
           ================================================================= -->
      <div class="sensor-diag-card">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">BATTERY & POWER PACK</span>
            <span class="sensor-pin">2S Li-ion / 7.4V Nominal</span>
          </div>
          <span class="card-badge {ble.batteryPct <= 20 ? 'danger' : 'ok'}">
            {ble.batteryPct <= 20 ? 'LOW VOLTAGE' : 'HEALTHY'}
          </span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">CURRENT CHARGE:</span>
          <span class="sensor-val ok">{ble.batteryPct}%</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">MEASURED VOLTAGE:</span>
          <span class="sensor-val">{ble.batteryVolts.toFixed(2)} V</span>
        </div>
        <div class="card-toggle-group" style="margin-top: 4px;">
          <span class="metric-label" style="font-size: 0.52rem;">ADC Pin: GPIO 36 (VP) | Voltage Divider 1:1</span>
        </div>
      </div>

      <!-- =================================================================
           SECTION 3: WI-FI & NETWORK STATE
           ================================================================= -->
      <div class="sensor-diag-card">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">WI-FI & NETWORK STATE</span>
            <span class="sensor-pin">ESP32 2.4GHz 802.11 b/g/n</span>
          </div>
          <span class="card-badge {ble.wifi.enabled ? (ble.wifi.connected ? 'ok' : 'disabled') : 'disabled'}">
            {ble.wifi.enabled ? (ble.wifi.connected ? 'CONNECTED' : 'SCAN READY') : 'RADIO OFF'}
          </span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">CONNECTED SSID:</span>
          <span class="sensor-val">{ble.wifi.ssid || 'None'}</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">ASSIGNED IP:</span>
          <span class="sensor-val ok">{ble.wifi.ip}</span>
        </div>
        <div class="card-toggle-group" style="justify-content: space-between; margin-top: 8px;">
          <span class="metric-label" style="font-size: 0.65rem; font-weight: 800; color: var(--black-solid);">
            ESP32 WI-FI RADIO:
          </span>
          <label class="cyber-switch-wrap">
            <input 
              type="checkbox" 
              checked={ble.wifi.enabled}
              onchange={(e) => ble.setWifiPower((e.target as HTMLInputElement).checked)}
            >
            <span class="switch-slider"></span>
          </label>
        </div>
        {#if onOpenWifi}
          <div class="card-actions-row" style="margin-top: 6px;">
            <button class="test-btn primary" onclick={() => { onClose(); onOpenWifi?.(); }}>
              OPEN WI-FI SCANNER
            </button>
          </div>
        {/if}
      </div>

      <!-- =================================================================
           SECTION 4: SYSTEM UPTIME & TELEMETRY
           ================================================================= -->
      <div class="sensor-diag-card">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">SYSTEM UPTIME & TELEMETRY</span>
            <span class="sensor-pin">Live Real-time Counters</span>
          </div>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">ESP32 HARDWARE UPTIME:</span>
          <span class="sensor-val ok">{ble.uptime}</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">BLE ROUND-TRIP LATENCY:</span>
          <span class="sensor-val">{ble.latency > 0 ? `${ble.latency} ms ping` : '-- ms ping'}</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">ACTIVE DRIVE MODE:</span>
          <span class="sensor-val">{ble.driveMode}</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">BLUETOOTH LINK:</span>
          <span class="sensor-val {ble.isConnected ? 'ok' : 'danger'}">
            {ble.isConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
      </div>

      <!-- =================================================================
           SECTION 5: VERSION & SYSTEM INFO
           ================================================================= -->
      <div class="sensor-diag-card">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">VERSION & SYSTEM INFO</span>
            <span class="sensor-pin">Svelte 5 + Lucide Icons</span>
          </div>
          <span class="card-badge ok">PWA OFFLINE READY</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">WEB APP VERSION:</span>
          <span class="sensor-val ok">{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v4.0.0'}</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">RENDER ENGINE:</span>
          <span class="sensor-val ok">Zero-VDOM Reactive Runes</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">FIRMWARE PROTOCOL:</span>
          <span class="sensor-val">ESP32 Core 3.x / Nordic UART</span>
        </div>
        <div class="card-actions-row">
          <button class="test-btn" onclick={forceUpdateApp} disabled={isPurging}>
            {isPurging ? 'UPDATING...' : 'UPDATE APP'}
          </button>
        </div>
      </div>

      <!-- =================================================================
           SECTION 6: COCKPIT PREFERENCES
           ================================================================= -->
      <div class="sensor-diag-card" style="grid-column: 1 / -1;">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">COCKPIT PREFERENCES</span>
            <span class="sensor-pin">Tactile Feedback & Haptics</span>
          </div>
        </div>
        <div class="card-toggle-group" style="justify-content: space-between; margin-top: 4px;">
          <span class="metric-label" style="font-size: 0.65rem; font-weight: 800; color: var(--black-solid);">
            HAPTIC TOUCH VIBRATION:
          </span>
          <label class="cyber-switch-wrap">
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

    <div class="modal-footer">
      <button class="test-btn" onclick={onClose}>CLOSE</button>
    </div>
  </div>
{/if}
