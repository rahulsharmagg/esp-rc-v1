<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import type { WifiNetwork } from '../lib/types';
  import { 
    X, 
    Wifi, 
    WifiOff, 
    RefreshCw, 
    Lock, 
    Unlock, 
    Zap, 
    Radio 
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    isOpen: boolean;
    onClose: () => void;
  }

  let { ble, isOpen, onClose }: Props = $props();

  let selectedSsid = $state<string | null>(null);
  let passwordInput = $state('');

  function handleSelectNetwork(net: WifiNetwork) {
    if (net.isEncrypted) {
      selectedSsid = net.ssid;
      passwordInput = '';
    } else {
      ble.connectToWifi(net.ssid, '');
      selectedSsid = null;
    }
  }

  function handleConnectSelected() {
    if (selectedSsid) {
      ble.connectToWifi(selectedSsid, passwordInput);
      selectedSsid = null;
      passwordInput = '';
    }
  }

  function getSignalBars(rssi: number) {
    if (rssi >= -55) return 4;
    if (rssi >= -68) return 3;
    if (rssi >= -80) return 2;
    return 1;
  }
</script>

{#if isOpen}
  <div class="sensor-modal open">
    <div class="modal-header">
      <div class="modal-title-box">
        <span class="modal-tag">NETWORK</span>
        <h2 class="modal-title">ESP32 2.4GHz WI-FI SCANNER & AP MANAGER</h2>
      </div>
      <button class="modal-close-btn" onclick={onClose} title="Close Wi-Fi Modal">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    <div class="wifi-modal-body">
      
      <!-- =================================================================
           CARD 1: WI-FI RADIO POWER & ADVISORY
           ================================================================= -->
      <div class="wifi-section-card">
        <div class="wifi-radio-row">
          <div class="wifi-radio-title-group">
            <span class="wifi-radio-title">ESP32 2.4GHz WI-FI RADIO POWER</span>
            <span class="wifi-radio-sub">Enables Station (STA) and Access Point (AP) transceiver</span>
          </div>
          <label class="cyber-switch-wrap">
            <input 
              type="checkbox" 
              checked={ble.wifi.enabled}
              onchange={(e) => ble.setWifiPower((e.target as HTMLInputElement).checked)}
            >
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="battery-advisory-box">
          <Zap size={15} color="#2563eb" strokeWidth={2.5} />
          <span class="advisory-text">
            <strong>Power Management Tip:</strong> Disabling Wi-Fi when controlling via Bluetooth extends 2S Li-ion battery life by up to 45%.
          </span>
        </div>
      </div>

      <!-- =================================================================
           CARD 2: CURRENT CONNECTION TELEMETRY
           ================================================================= -->
      <div class="wifi-section-card">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">ACTIVE CONNECTION STATUS</span>
            <span class="sensor-pin">ESP32 802.11 b/g/n PHY</span>
          </div>
          <span class="card-badge {ble.wifi.enabled ? (ble.wifi.connected ? 'ok' : 'disabled') : 'disabled'}">
            {ble.wifi.enabled ? (ble.wifi.connected ? 'CONNECTED' : 'STANDBY') : 'RADIO OFF'}
          </span>
        </div>

        <div class="wifi-status-metrics-grid">
          <div class="card-metric-row">
            <span class="metric-label">CONNECTED SSID:</span>
            <span class="sensor-val">{ble.wifi.ssid || 'None'}</span>
          </div>
          <div class="card-metric-row">
            <span class="metric-label">ASSIGNED IP:</span>
            <span class="sensor-val ok">{ble.wifi.ip}</span>
          </div>
          <div class="card-metric-row">
            <span class="metric-label">SIGNAL STRENGTH:</span>
            <span class="sensor-val">{ble.wifi.rssi !== 0 ? `${ble.wifi.rssi} dBm` : '--'}</span>
          </div>
        </div>

        {#if ble.wifi.connected}
          <div class="card-actions-row" style="margin-top: 4px;">
            <button class="test-btn danger" onclick={() => ble.disconnectWifi()}>
              DISCONNECT WI-FI
            </button>
          </div>
        {/if}
      </div>

      <!-- =================================================================
           CARD 3: AIRWAVE SCANNER & DISCOVERED ACCESS POINTS
           ================================================================= -->
      <div class="wifi-section-card">
        <div class="card-header">
          <div class="card-name-group">
            <span class="sensor-name">AVAILABLE ACCESS POINTS (2.4GHz)</span>
            <span class="sensor-pin">Real-time Beacon Scan</span>
          </div>
          <button 
            class="test-btn" 
            onclick={() => ble.scanWifi()} 
            disabled={!ble.wifi.enabled || ble.isScanningWifi}
            title="Scan Wi-Fi Airwaves"
          >
            <RefreshCw size={12} strokeWidth={2.5} class={ble.isScanningWifi ? 'radar-scan-spinner' : ''} />
            <span>{ble.isScanningWifi ? 'SCANNING...' : 'SCAN NETWORKS'}</span>
          </button>
        </div>

        {#if !ble.wifi.enabled}
          <div class="wifi-empty-state">
            <WifiOff size={22} color="#94a3b8" strokeWidth={2} style="margin: 0 auto 4px auto;" />
            <div>Wi-Fi radio is currently powered down.</div>
            <div style="font-size: 0.58rem; color: #94a3b8; margin-top: 2px;">Enable the switch above to scan for nearby networks.</div>
          </div>
        {:else if ble.isScanningWifi}
          <div class="wifi-scanning-placeholder">
            <div class="radar-scan-spinner"></div>
            <span>Listening for 2.4GHz 802.11 beacon packets...</span>
          </div>
        {:else if ble.wifiNetworks.length === 0}
          <div class="wifi-empty-state">
            <Radio size={22} color="#94a3b8" strokeWidth={2} style="margin: 0 auto 4px auto;" />
            <div>No Wi-Fi access points detected in range.</div>
            <div style="font-size: 0.58rem; color: #94a3b8; margin-top: 2px;">Click "SCAN NETWORKS" to perform an active broadcast probe.</div>
          </div>
        {:else}
          <div class="wifi-scan-list-container">
            {#each ble.wifiNetworks as net}
              {@const isCurrent = ble.wifi.connected && ble.wifi.ssid === net.ssid}
              {@const bars = getSignalBars(net.rssi)}
              <div class="wifi-network-item {isCurrent ? 'current' : ''}">
                <div class="net-left">
                  <!-- Signal Strength Bars -->
                  <div class="wifi-signal-bars" title="{net.rssi} dBm">
                    <div class="bar b1 {bars >= 1 ? 'active' : ''}"></div>
                    <div class="bar b2 {bars >= 2 ? 'active' : ''}"></div>
                    <div class="bar b3 {bars >= 3 ? 'active' : ''}"></div>
                    <div class="bar b4 {bars >= 4 ? 'active' : ''}"></div>
                  </div>

                  <!-- Security Lock -->
                  {#if net.isEncrypted}
                    <Lock size={12} color="#64748b" strokeWidth={2.5} />
                  {:else}
                    <Unlock size={12} color="#16a34a" strokeWidth={2.5} />
                  {/if}

                  <div class="net-info">
                    <span class="net-ssid">{net.ssid}</span>
                    <span class="net-sub">{net.rssi} dBm &bull; {net.isEncrypted ? 'WPA2/WPA3' : 'OPEN'}</span>
                  </div>
                </div>

                <div class="net-right">
                  {#if isCurrent}
                    <span class="net-current-tag">ACTIVE</span>
                  {:else}
                    <button class="net-connect-btn" onclick={() => handleSelectNetwork(net)}>
                      CONNECT
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Inline Password Prompt Card -->
        {#if selectedSsid}
          <div class="wifi-connect-card">
            <div class="connect-header">
              <strong>Connect to:</strong> {selectedSsid}
            </div>
            <div class="connect-input-row">
              <input 
                type="password" 
                class="wifi-password-input" 
                placeholder="Enter WPA2 Network Password..."
                bind:value={passwordInput}
                onkeydown={(e) => e.key === 'Enter' && handleConnectSelected()}
              />
            </div>
            <div class="connect-actions-row">
              <button class="test-btn primary" onclick={handleConnectSelected}>
                CONNECT
              </button>
              <button class="test-btn" onclick={() => { selectedSsid = null; passwordInput = ''; }}>
                CANCEL
              </button>
            </div>
          </div>
        {/if}

      </div>

    </div>

    <div class="modal-footer">
      <button class="test-btn" onclick={onClose}>CLOSE</button>
    </div>
  </div>
{/if}
