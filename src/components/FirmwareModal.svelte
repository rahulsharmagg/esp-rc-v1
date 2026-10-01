<script lang="ts">
  import { untrack } from 'svelte';
  import type { BLEController } from '../lib/ble.svelte';
  import { 
    X, 
    ArrowUpCircle, 
    RefreshCw, 
    CheckCircle2, 
    AlertCircle, 
    Cpu, 
    Wifi, 
    ShieldCheck, 
    RotateCcw,
    History,
    DownloadCloud
  } from '@lucide/svelte';

  interface Props {
    ble: BLEController;
    isOpen: boolean;
    onClose: () => void;
    onOpenWifi?: () => void;
  }

  let { ble, isOpen, onClose, onOpenWifi }: Props = $props();

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

  let selectedManifest = $derived.by(() => {
    if (!ble.availableVersions || ble.availableVersions.length === 0) return null;
    return ble.availableVersions.find(v => v.version === ble.selectedVersion) || ble.availableVersions[0];
  });
</script>

{#if isOpen}
  <div class="sensor-modal open standard-modal">
    <!-- Header -->
    <div class="modal-header">
      <div class="modal-title-box">
        <span class="modal-tag">OTA SYSTEM</span>
        <h2 class="modal-title">FIRMWARE UPDATE</h2>
      </div>
      <button class="modal-close-btn" onclick={onClose} title="Close Firmware Window">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    <!-- Body -->
    <div class="modal-body settings-list-scroll">
      
      <!-- 1. Status Overview Group -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(37, 99, 235, 0.12); color: #2563eb;">
            <ShieldCheck size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">UPDATE STATUS</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">
                {#if ble.otaStatus === 'UPDATING'}
                  Flashing Firmware in Progress...
                {:else if ble.hasFirmwareUpdate}
                  New Firmware Release Available (v{ble.latestFirmwareVer})
                {:else}
                  Firmware is Up to Date
                {/if}
              </span>
              <span class="settings-item-sub">
                Installed: <strong>v{ble.currentFirmwareVer}</strong> • Server Stable: <strong>v{ble.latestFirmwareVer}</strong>
              </span>
            </div>
            <div class="settings-row-right">
              <button 
                class="test-btn" 
                onclick={() => ble.checkFirmwareUpdate()}
                disabled={ble.isCheckingFirmware || ble.otaStatus === 'UPDATING'}
                title="Check latest releases"
              >
                <RefreshCw size={11} class={ble.isCheckingFirmware ? 'animate-spin' : ''} style="margin-right: 3px;" />
                {ble.isCheckingFirmware ? 'CHECKING...' : 'CHECK UPDATES'}
              </button>
            </div>
          </div>

          <!-- Live Progress Bar when updating -->
          {#if ble.otaStatus === 'UPDATING'}
            <div style="margin: 8px 0; padding: 10px; background: #18181b; border-radius: 0px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.62rem; font-family: var(--font-mono); color: #fff; margin-bottom: 4px;">
                <span style="color: #60a5fa; font-weight: 700;">WRITING TO ESP32 FLASH...</span>
                <span>{ble.otaProgress}%</span>
              </div>
              <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.15); border-radius: 0px; overflow: hidden;">
                <div style="width: {ble.otaProgress}%; height: 100%; background: #3b82f6; transition: width 0.3s ease;"></div>
              </div>
              <div style="font-size: 0.55rem; color: #a1a1aa; margin-top: 4px; font-family: var(--font-mono);">
                {ble.otaMessage || 'Streaming binary chunks over Wi-Fi...'}
              </div>
            </div>
          {:else if ble.otaStatus === 'SUCCESS'}
            <div style="margin: 8px 0; padding: 8px 10px; background: #f0fdf4; border: 1px solid #22c55e; border-radius: 0px; display: flex; align-items: center; gap: 6px;">
              <CheckCircle2 size={14} color="#16a34a" />
              <span style="font-size: 0.62rem; color: #16a34a; font-weight: 700; font-family: var(--font-mono);">{ble.otaMessage}</span>
            </div>
          {:else if ble.otaStatus === 'ERROR'}
            <div style="margin: 8px 0; padding: 8px 10px; background: #fef2f2; border: 1px solid #ef4444; border-radius: 0px; display: flex; align-items: center; gap: 6px;">
              <AlertCircle size={14} color="#dc2626" />
              <span style="font-size: 0.62rem; color: #dc2626; font-weight: 700; font-family: var(--font-mono);">{ble.otaMessage}</span>
            </div>
          {/if}

          <!-- Direct Update Action if update available -->
          {#if ble.hasFirmwareUpdate && ble.otaStatus !== 'UPDATING'}
            <div class="settings-row settings-action-row" style="border-top: 1px solid #f1f5f9;">
              <div class="settings-row-left">
                <span class="settings-item-title" style="color: #c2410c;">Install Update v{ble.latestFirmwareVer}</span>
                <span class="settings-item-sub">Over-The-Air automatic flash and restart</span>
              </div>
              <div class="settings-row-right">
                <button 
                  class="test-btn primary" 
                  onclick={() => ble.startFirmwareUpdate(ble.latestFirmwareVer)}
                  disabled={!ble.wifi.connected || ble.otaStatus === 'UPDATING'}
                >
                  <DownloadCloud size={12} style="margin-right: 3px;" />
                  INSTALL NOW
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- 2. Version Catalog & Rollback Group -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(100, 116, 139, 0.12); color: #475569;">
            <History size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">VERSION CATALOG & ROLLBACK</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">Target Version Selection</span>
              <span class="settings-item-sub">Choose any retained release to flash or downgrade</span>
            </div>
            <div class="settings-row-right">
              <span class="settings-badge ok">{ble.availableVersions.length} RELEASES</span>
            </div>
          </div>

          <div style="padding: 8px 0; background: transparent; border-top: 1px solid #f1f5f9;">
            <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end;">
              <div style="flex: 1; min-width: 180px;">
                <label for="fw-modal-select" style="display: block; font-size: 0.55rem; font-weight: 800; color: #64748b; font-family: var(--font-mono); margin-bottom: 2px;">
                  SELECT VERSION:
                </label>
                <select 
                  id="fw-modal-select" 
                  bind:value={ble.selectedVersion}
                  disabled={ble.otaStatus === 'UPDATING'}
                  style="width: 100%; padding: 5px 8px; font-size: 0.68rem; font-family: var(--font-mono); background: #ffffff; border: 1.5px solid #0a0e17; border-radius: 0px;"
                >
                  {#if ble.availableVersions.length === 0}
                    <option value={ble.latestFirmwareVer}>v{ble.latestFirmwareVer} (Stable)</option>
                  {:else}
                    {#each ble.availableVersions as ver}
                      <option value={ver.version}>
                        v{ver.version} {ver.isStable ? '★ STABLE' : ''} {ver.version === ble.currentFirmwareVer ? '(Installed)' : ''}
                      </option>
                    {/each}
                  {/if}
                </select>
              </div>

              <div>
                <button 
                  class="test-btn" 
                  onclick={() => ble.startFirmwareUpdate(ble.selectedVersion)}
                  disabled={!ble.wifi.connected || ble.otaStatus === 'UPDATING' || !ble.selectedVersion}
                  title={!ble.wifi.connected ? 'Connect ESP32 to Wi-Fi first' : `Flash v${ble.selectedVersion}`}
                >
                  <RotateCcw size={11} style="margin-right: 3px;" />
                  FLASH v{ble.selectedVersion || ble.latestFirmwareVer}
                </button>
              </div>
            </div>

            {#if selectedManifest}
              <div style="margin-top: 8px; padding: 6px 8px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 0px; display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px;">
                <div>
                  <span style="font-size: 0.52rem; font-weight: 700; color: #94a3b8; font-family: var(--font-mono); display: block;">Target Device:</span>
                  <span style="font-size: 0.6rem; font-weight: 800; color: #1e293b; font-family: var(--font-mono);">{selectedManifest.device || 'esp32-robot'}</span>
                </div>
                <div>
                  <span style="font-size: 0.52rem; font-weight: 700; color: #94a3b8; font-family: var(--font-mono); display: block;">Binary Size:</span>
                  <span style="font-size: 0.6rem; font-weight: 800; color: #1e293b; font-family: var(--font-mono);">{(selectedManifest.size / 1024).toFixed(1)} KB</span>
                </div>
                {#if selectedManifest.sha256}
                  <div>
                    <span style="font-size: 0.52rem; font-weight: 700; color: #94a3b8; font-family: var(--font-mono); display: block;">SHA-256 Checksum:</span>
                    <span style="font-size: 0.58rem; font-weight: 800; color: #2563eb; font-family: var(--font-mono);" title={selectedManifest.sha256}>
                      {selectedManifest.sha256.substring(0, 14)}...
                    </span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- 3. Network Requirement Group -->
      <div class="settings-group">
        <div class="settings-group-header">
          <div class="settings-icon-chip" style="background: rgba(22, 163, 74, 0.12); color: #16a34a;">
            <Wifi size={14} strokeWidth={2.5} />
          </div>
          <span class="settings-group-title">NETWORK REQUIREMENT</span>
        </div>

        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-left">
              <span class="settings-item-title">
                {ble.wifi.connected ? `Wi-Fi Connected (${ble.wifi.ssid})` : 'ESP32 Wi-Fi Disconnected'}
              </span>
              <span class="settings-item-sub">
                {ble.wifi.connected 
                  ? `Assigned IP: ${ble.wifi.ip} • Ready for Over-The-Air downloads` 
                  : 'ESP32 must be connected to Wi-Fi to download firmware binaries.'}
              </span>
            </div>
            <div class="settings-row-right">
              {#if ble.wifi.connected}
                <span class="settings-badge ok">READY</span>
              {:else if onOpenWifi}
                <button class="test-btn primary" onclick={() => { onClose(); onOpenWifi?.(); }}>
                  CONNECT WI-FI
                </button>
              {/if}
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

  .settings-action-row {
    background: transparent;
  }
</style>
