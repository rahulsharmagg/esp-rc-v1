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
    CheckCircle2,
    Eye,
    EyeOff,
    KeyRound
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    isOpen: boolean;
    onClose: () => void;
  }

  let { ble, isOpen, onClose }: Props = $props();

  let selectedSsid = $state<string | null>(null);
  let passwordInput = $state('');
  let showPassword = $state(false);
  let showPasswordModal = $state(false);

  function handleSelectNetwork(net: WifiNetwork) {
    if (net.isEncrypted) {
      selectedSsid = net.ssid;
      passwordInput = '';
      showPassword = false;
      showPasswordModal = true;
    } else {
      ble.connectToWifi(net.ssid, '');
      selectedSsid = null;
      showPasswordModal = false;
    }
  }

  function handleConnectSelected() {
    if (selectedSsid) {
      ble.connectToWifi(selectedSsid, passwordInput);
      closePasswordModal();
    }
  }

  function closePasswordModal() {
    showPasswordModal = false;
    selectedSsid = null;
    passwordInput = '';
    showPassword = false;
  }

  function getSignalBars(rssi: number) {
    if (rssi >= -55) return 4;
    if (rssi >= -68) return 3;
    if (rssi >= -80) return 2;
    return 1;
  }
</script>

{#if isOpen}
  <div class="sensor-modal open standard-modal">
    <!-- Header -->
    <div class="modal-header">
      <div class="modal-title-box">
        <span class="modal-tag">NETWORK</span>
        <h2 class="modal-title">WI-FI</h2>
      </div>
      <button class="modal-close-btn" onclick={onClose} title="Close Wi-Fi Window">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    <!-- Body -->
    <div class="modal-body settings-list-scroll">

      <!-- 1. Wi-Fi Power Switch Group -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(37, 99, 235, 0.12); color: #2563eb;">
            <Wifi size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">WI-FI POWER</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Wi-Fi</span>
              <span class="settings-item-sub">
                {#if !ble.wifi.enabled}
                  Wi-Fi is turned off
                {:else if ble.wifi.connected}
                  Connected to <strong style="color: var(--black-solid);">{ble.wifi.ssid}</strong>
                {:else}
                  Wi-Fi is turned on (Searching)
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
        </div>
      </div>

      <!-- 2. Active Connection Group -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(22, 163, 74, 0.12); color: #16a34a;">
            <CheckCircle2 size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">ACTIVE CONNECTION</span>
        </div>

        <div class="settings-card">
          {#if ble.wifi.enabled && ble.wifi.connected}
            <!-- Connected State: Full Details -->
            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Connected Network</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-badge ok">{ble.wifi.ssid}</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Assigned IP Address</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-value-mono" style="color: #16a34a;">{ble.wifi.ip}</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Signal Strength</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-value-mono">{ble.wifi.rssi !== 0 ? `${ble.wifi.rssi} dBm` : '--'}</span>
              </div>
            </div>

            <div class="settings-row settings-action-row">
              <div class="settings-row-left">
                <span class="settings-item-title" style="font-size: 0.65rem;">Disconnect Network</span>
                <span class="settings-item-sub">Release IP lease and disconnect</span>
              </div>
              <div class="settings-row-right">
                <button class="test-btn" onclick={() => ble.disconnectWifi()}>
                  DISCONNECT
                </button>
              </div>
            </div>
          {:else}
            <!-- Not Connected State: Simple Message -->
            <div class="settings-row">
              <div class="settings-row-left">
                <span class="settings-item-title">Status</span>
                <span class="settings-item-sub">Not connected to any network</span>
              </div>
              <div class="settings-row-right">
                <span class="settings-badge disabled">DISCONNECTED</span>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- 3. Available Networks Group -->
      <div class="settings-group">
        <div class="settings-group-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="settings-icon-chip" style="background: rgba(234, 88, 12, 0.12); color: #ea580c;">
              <RefreshCw size={14} strokeWidth={2.5} />
            </div>
            <span class="settings-group-title">AVAILABLE NETWORKS</span>
          </div>

          <button 
            class="test-btn" 
            onclick={() => ble.startWifiScan()}
            disabled={!ble.wifi.enabled || ble.isScanningWifi}
            title={!ble.wifi.enabled ? 'Turn on Wi-Fi first' : 'Scan for nearby networks'}
          >
            <RefreshCw size={11} class={ble.isScanningWifi ? 'animate-spin' : ''} style="margin-right: 3px;" />
            {ble.isScanningWifi ? 'SCANNING...' : 'SCAN NETWORKS'}
          </button>
        </div>

        <div class="settings-card">
          {#if !ble.wifi.enabled}
            <div class="wifi-state-notice">
              <WifiOff size={22} color="#94a3b8" />
              <div>Wi-Fi is turned off.</div>
              <div style="font-size: 0.58rem; color: #94a3b8; margin-top: 2px;">Turn on Wi-Fi above to view available networks.</div>
            </div>
          {:else if ble.isScanningWifi}
            <div class="wifi-state-notice">
              <RefreshCw size={22} class="animate-spin" color="#3b82f6" />
              <div>Scanning for available networks...</div>
            </div>
          {:else if ble.wifiNetworks.length === 0}
            <div class="wifi-state-notice">
              <Wifi size={22} color="#94a3b8" />
              <div>No networks discovered yet.</div>
              <div style="font-size: 0.58rem; color: #94a3b8; margin-top: 2px;">Click "SCAN NETWORKS" to search for access points.</div>
            </div>
          {:else}
            <div class="wifi-scan-list">
              {#each ble.wifiNetworks as net}
                {@const isCurrent = ble.wifi.connected && ble.wifi.ssid === net.ssid}
                {@const bars = getSignalBars(net.rssi)}
                <div class="settings-row {isCurrent ? 'settings-action-row' : ''}">
                  <div class="settings-row-left" style="flex-direction: row; align-items: center; gap: 8px;">
                    <!-- Signal Bars -->
                    <div class="wifi-signal-bars" title="{net.rssi} dBm">
                      <div class="bar b1 {bars >= 1 ? 'active' : ''}"></div>
                      <div class="bar b2 {bars >= 2 ? 'active' : ''}"></div>
                      <div class="bar b3 {bars >= 3 ? 'active' : ''}"></div>
                      <div class="bar b4 {bars >= 4 ? 'active' : ''}"></div>
                    </div>

                    <!-- Security Lock -->
                    {#if net.isEncrypted}
                      <Lock size={12} color="#64748b" />
                    {:else}
                      <Unlock size={12} color="#16a34a" />
                    {/if}

                    <div style="display: flex; flex-direction: column;">
                      <span class="settings-item-title">{net.ssid}</span>
                      <span class="settings-item-sub">{net.rssi} dBm • {net.isEncrypted ? 'WPA/WPA2' : 'OPEN'}</span>
                    </div>
                  </div>

                  <div class="settings-row-right">
                    {#if isCurrent}
                      <span class="settings-badge ok">CONNECTED</span>
                    {:else}
                      <button class="test-btn" onclick={() => handleSelectNetwork(net)}>
                        CONNECT
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button class="test-btn primary" onclick={onClose} style="min-width: 90px;">
        DONE
      </button>
    </div>

    <!-- =================================================================
         PASSWORD MODAL OVERLAY (Appears on top of Wi-Fi window)
         ================================================================= -->
    {#if showPasswordModal && selectedSsid}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div 
        class="pwd-modal-overlay" 
        onclick={(e) => { if (e.target === e.currentTarget) closePasswordModal(); }}
        onkeydown={(e) => { if (e.key === 'Escape') closePasswordModal(); }}
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="Wi-Fi Password Dialog"
      >
        <div class="pwd-modal-dialog">
          <div class="pwd-modal-header">
            <div style="display: flex; align-items: center; gap: 6px;">
              <KeyRound size={15} color="#dc2626" strokeWidth={2.5} />
              <span class="pwd-modal-title">ENTER PASSWORD</span>
            </div>
            <button class="pwd-close-btn" onclick={closePasswordModal} title="Cancel">
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>

          <div class="pwd-modal-body">
            <div class="pwd-ssid-target">
              Connect to <strong style="color: var(--black-solid);">{selectedSsid}</strong>
            </div>

            <div class="pwd-input-wrap">
              <input 
                type={showPassword ? 'text' : 'password'}
                class="pwd-text-input"
                placeholder="Enter WPA/WPA2 password..."
                bind:value={passwordInput}
                onkeydown={(e) => e.key === 'Enter' && handleConnectSelected()}
              />
              <button 
                type="button" 
                class="pwd-eye-btn" 
                onclick={() => showPassword = !showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {#if showPassword}
                  <EyeOff size={14} color="#64748b" />
                {:else}
                  <Eye size={14} color="#64748b" />
                {/if}
              </button>
            </div>
          </div>

          <div class="pwd-modal-footer">
            <button class="test-btn" onclick={closePasswordModal}>
              CANCEL
            </button>
            <button class="test-btn primary" onclick={handleConnectSelected}>
              CONNECT
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

  .settings-badge.disabled {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }

  .settings-value-mono {
    font-size: 0.65rem;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    color: #334155;
  }

  .settings-action-row {
    background: transparent;
  }

  .wifi-state-notice {
    padding: 24px 12px;
    text-align: center;
    font-size: 0.65rem;
    font-weight: 700;
    color: #475569;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .wifi-scan-list {
    max-height: 220px;
    overflow-y: auto;
  }

  /* Signal Bars */
  .wifi-signal-bars {
    display: flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 14px;
    width: 14px;
  }

  .wifi-signal-bars .bar {
    flex: 1;
    background: #cbd5e1;
    border-radius: 0px;
  }

  .wifi-signal-bars .bar.b1 { height: 25%; }
  .wifi-signal-bars .bar.b2 { height: 50%; }
  .wifi-signal-bars .bar.b3 { height: 75%; }
  .wifi-signal-bars .bar.b4 { height: 100%; }

  .wifi-signal-bars .bar.active {
    background: #16a34a;
  }

  /* =========================================================================
     PASSWORD POPUP MODAL OVERLAY
     ========================================================================= */
  .pwd-modal-overlay {
    position: absolute;
    inset: 0;
    background: rgba(10, 14, 23, 0.65);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  .pwd-modal-dialog {
    width: 100%;
    max-width: 360px;
    background: #ffffff;
    border: 2px solid var(--black-solid, #0a0e17);
    border-radius: 0px;
    box-shadow: 4px 4px 0px var(--black-solid, #0a0e17);
    display: flex;
    flex-direction: column;
    animation: slideUp 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .pwd-modal-header {
    height: 38px;
    background: var(--black-solid, #0a0e17);
    color: #ffffff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 10px;
  }

  .pwd-modal-title {
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.5px;
    font-family: var(--font-mono, monospace);
  }

  .pwd-close-btn {
    background: transparent;
    border: none;
    color: #ffffff;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
  }

  .pwd-close-btn:hover {
    color: var(--red-primary);
  }

  .pwd-modal-body {
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #ffffff;
  }

  .pwd-ssid-target {
    font-size: 0.65rem;
    color: #475569;
    font-family: var(--font-mono, monospace);
  }

  .pwd-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .pwd-text-input {
    width: 100%;
    padding: 7px 32px 7px 8px;
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    background: #ffffff;
    border: 1.5px solid var(--black-solid, #0a0e17);
    border-radius: 0px;
    box-sizing: border-box;
  }

  .pwd-text-input:focus {
    outline: 2px solid var(--red-primary, #dc2626);
    outline-offset: 1px;
  }

  .pwd-eye-btn {
    position: absolute;
    right: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 2px;
  }

  .pwd-modal-footer {
    height: 42px;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 0 10px;
    gap: 6px;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { transform: scale(0.96) translateY(8px); opacity: 0; }
    to { transform: scale(1) translateY(0); opacity: 1; }
  }
</style>
