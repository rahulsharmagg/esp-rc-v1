<script lang="ts">
  import { onMount } from 'svelte';
  import type { BLEController } from '../lib/ble.svelte';
  import { 
    Wifi, 
    WifiOff, 
    Settings, 
    Bluetooth, 
    Maximize, 
    Minimize 
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    onOpenWifi?: () => void;
    onOpenSettings: () => void;
  }

  let { ble, onOpenWifi, onOpenSettings }: Props = $props();

  let isFullscreen = $state(false);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      isFullscreen = true;
    } else {
      document.exitFullscreen().catch(() => {});
      isFullscreen = false;
    }
  }

  onMount(() => {
    const handler = () => {
      isFullscreen = !!document.fullscreenElement;
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  });

  let batteryFillClass = $derived.by(() => {
    if (ble.batteryPct <= 20) return 'battery-level-fill danger';
    if (ble.batteryPct <= 50) return 'battery-level-fill warn';
    return 'battery-level-fill';
  });

  let wifiStatusClass = $derived.by(() => {
    if (!ble.wifi.enabled) return 'wifi-status-indicator wifi-off';
    if (ble.wifi.connected) return 'wifi-status-indicator wifi-connected';
    return 'wifi-status-indicator wifi-on';
  });

  let wifiTooltip = $derived.by(() => {
    if (!ble.wifi.enabled) return 'Wi-Fi: Radio OFF';
    if (ble.wifi.connected) return `Wi-Fi: Connected (${ble.wifi.ssid || 'ESP32-AP'})`;
    return 'Wi-Fi: Radio ON (Standby)';
  });
</script>

<header class="cockpit-top-bar">
  <!-- Brand / Title -->
  <div class="top-left">
    <img src="/logo.svg" alt="ESP-RC Logo" class="bar-logo" />
    <div class="bar-title-wrap">
      <span class="bar-title">ESP-RC</span>
      <span class="bar-latency">{ble.latency > 0 ? `${ble.latency} ms` : '-- ms'}</span>
    </div>
  </div>

  <!-- Telemetry Pills & Status / Settings Controls -->
  <div class="top-center">
    <div class="telemetry-pill">
      <span class="pill-lbl">MODE</span>
      <span class="pill-val">{ble.driveMode}</span>
    </div>
    
    <div class="telemetry-pill pill-uptime">
      <span class="pill-lbl">UPTIME</span>
      <span class="pill-val">{ble.uptime}</span>
    </div>

    <!-- Battery Status Telemetry Pill -->
    {#if ble.hasBattery}
      <div class="battery-pill" title="ESP32 Battery Level: {ble.batteryPct}% ({ble.batteryVolts.toFixed(1)}V)">
        <div class="battery-icon-wrap">
          <div class="battery-shell">
            <div class={batteryFillClass} style="width: {Math.max(5, Math.min(100, ble.batteryPct))}%;"></div>
          </div>
          <div class="battery-nipple"></div>
        </div>
        <span class="pill-val">{ble.batteryPct}%</span>
        <span class="pill-sub">({ble.batteryVolts.toFixed(1)}V)</span>
      </div>
    {:else}
      <div class="battery-pill no-battery" title="No Battery Detected (USB / External 5V Power)">
        <div class="battery-icon-wrap">
          <div class="battery-shell no-bat">
            <div class="no-bat-line"></div>
          </div>
          <div class="battery-nipple no-bat"></div>
        </div>
        <span class="pill-val no-bat-text">NO BAT</span>
      </div>
    {/if}

    <!-- Wi-Fi Status Indicator & Scanner Trigger -->
    <button 
      class={wifiStatusClass} 
      title={wifiTooltip}
      onclick={onOpenWifi}
      style="cursor: pointer;"
      aria-label="Open Wi-Fi Scanner"
    >
      {#if ble.wifi.enabled}
        <Wifi size={14} strokeWidth={2.5} />
      {:else}
        <WifiOff size={14} strokeWidth={2.5} />
      {/if}
      <span class="wifi-indicator-dot"></span>
    </button>

    <!-- Settings Trigger with Gear Icon -->
    <button 
      class="bar-btn btn-settings-trigger" 
      title="System Settings, Sensors & Wi-Fi Configuration"
      onclick={onOpenSettings}
    >
      <Settings size={14} strokeWidth={2.5} />
      <span class="btn-text">SETTINGS</span>
    </button>

    <!-- Fullscreen Toggle Button -->
    <button 
      class="bar-btn btn-fullscreen" 
      title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen Mode"}
      onclick={toggleFullscreen}
    >
      {#if isFullscreen}
        <Minimize size={14} strokeWidth={2.5} />
      {:else}
        <Maximize size={14} strokeWidth={2.5} />
      {/if}
      <span class="btn-text">{isFullscreen ? 'EXIT' : 'FULL'}</span>
    </button>
  </div>

  <!-- Connection Status (BLE / LAN / HYBRID) & Connect Button -->
  <div class="top-right">
    <div class="status-badge" title="Active Connection Mode: {ble.activeConnectionMode}">
      <span class="status-dot {ble.activeConnectionMode !== 'OFFLINE' ? 'connected' : ''}"></span>
      <span class="status-text">
        {#if ble.activeConnectionMode === 'HYBRID'}
          HYBRID (BLE+LAN)
        {:else if ble.activeConnectionMode === 'LAN'}
          LAN ({ble.wifi.ip || 'Wi-Fi'})
        {:else if ble.activeConnectionMode === 'BLE'}
          {ble.deviceName}
        {:else}
          DISCONNECTED
        {/if}
      </span>
    </div>

    {#if !ble.isConnected}
      <button class="btn-pair" onclick={() => ble.connect()} disabled={ble.isConnecting}>
        <Bluetooth size={14} strokeWidth={2.5} />
        <span>{ble.isConnecting ? 'CONNECTING...' : 'CONNECT'}</span>
      </button>
    {:else}
      <button class="btn-disconnect" onclick={() => ble.disconnect()}>
        <span>DISCONNECT</span>
      </button>
    {/if}
  </div>
</header>
