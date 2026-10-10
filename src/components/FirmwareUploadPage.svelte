<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    UploadCloud, 
    Lock, 
    Eye,
    EyeOff,
    FileCode2, 
    CheckCircle2, 
    AlertTriangle, 
    ArrowLeft, 
    Layers, 
    Cpu, 
    ShieldCheck, 
    Loader2,
    HardDrive,
    Tag,
    Clock,
    Copy,
    Check,
    DownloadCloud,
    RefreshCw,
    Terminal,
    Sparkles,
    Radio,
    FileCheck,
    FileText,
    X
  } from '@lucide/svelte';
  import type { FirmwareVersionInfo, FirmwareVersionsResponse } from '../lib/types';
  import { router } from '../lib/router.svelte';

  interface Props {
    onNavigateHome?: () => void;
  }

  let { onNavigateHome }: Props = $props();

  function handleGoHome() {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      router.navigate('/');
    }
  }

  // Form States
  let adminPassword = $state('');
  let showPassword = $state(false);
  let targetVersion = $state('');
  let releaseChannel = $state<'stable' | 'beta' | 'dev'>('stable');
  let releaseDescription = $state('');
  let isStable = $state(true);
  let selectedFile = $state<File | null>(null);
  let fileError = $state('');

  // UI Interactive States
  let isDragging = $state(false);
  let isUploading = $state(false);
  let uploadProgress = $state(0);
  let uploadedBytes = $state(0);
  let totalBytes = $state(0);

  // Alerts & Notifications
  let alertMessage = $state('');
  let alertType = $state<'success' | 'error' | ''>('');
  let copiedSha = $state<string | null>(null);

  // Versions Repository List
  let existingVersions = $state<FirmwareVersionInfo[]>([]);
  let isLoadingVersions = $state(false);
  let searchQuery = $state('');

  // Derived Values
  let latestVersion = $derived(existingVersions.length > 0 ? existingVersions[0].version : '1.0.0');
  let filteredVersions = $derived(
    existingVersions.filter(v => 
      v.version.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (v.channel && v.channel.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  onMount(() => {
    if (typeof localStorage !== 'undefined') {
      const savedPwd = localStorage.getItem('esp_admin_pwd');
      if (savedPwd) adminPassword = savedPwd;
    }
    fetchExistingVersions();
  });

  async function fetchExistingVersions() {
    isLoadingVersions = true;
    try {
      const res = await fetch('/api/firmware/versions?device=esp32-robot', { cache: 'no-store' });
      if (res.ok) {
        const data: FirmwareVersionsResponse = await res.json();
        if (data && Array.isArray(data.versions)) {
          existingVersions = data.versions;
        }
      }
    } catch (_) {
      // ignore
    } finally {
      isLoadingVersions = false;
    }
  }

  function handleFile(file: File) {
    fileError = '';
    alertMessage = '';
    if (!file.name.toLowerCase().endsWith('.bin')) {
      fileError = 'Invalid file format. Only compiled .bin binary files are accepted.';
      selectedFile = null;
      return;
    }

    selectedFile = file;

    // Auto-detect version from filename (e.g. firmware-1.0.8.bin -> 1.0.8)
    const match = file.name.match(/(?:v|firmware[-_]?|esp[-_]rc[-_]?)(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/i);
    if (match && !targetVersion) {
      targetVersion = match[1];
    } else if (!targetVersion && existingVersions.length > 0) {
      suggestNextVersion('patch');
    }
  }

  function handleFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      handleFile(input.files[0]);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  function removeSelectedFile() {
    selectedFile = null;
    fileError = '';
  }

  function suggestNextVersion(type: 'patch' | 'minor' | 'major') {
    const base = existingVersions.length > 0 ? existingVersions[0].version : '1.0.0';
    const parts = base.split('.').map(n => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);

    if (type === 'patch') parts[2]++;
    else if (type === 'minor') { parts[1]++; parts[2] = 0; }
    else if (type === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }

    targetVersion = `${parts[0]}.${parts[1]}.${parts[2]}`;
  }

  function copyToClipboard(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      copiedSha = text;
      setTimeout(() => copiedSha = null, 2000);
    }
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();

    const pwd = adminPassword.trim();
    const ver = targetVersion.trim();

    if (!pwd) {
      alertType = 'error';
      alertMessage = 'Admin Secret Password is required to publish firmware.';
      return;
    }

    if (!selectedFile) {
      alertType = 'error';
      alertMessage = 'Please select or drag & drop a valid .bin firmware binary.';
      return;
    }

    if (!ver || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-.*)?$/.test(ver)) {
      alertType = 'error';
      alertMessage = 'Invalid SemVer format. Example: 1.0.8 or 1.1.0-beta.1';
      return;
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('esp_admin_pwd', pwd);
    }

    isUploading = true;
    uploadProgress = 0;
    uploadedBytes = 0;
    totalBytes = selectedFile.size;
    alertMessage = '';
    alertType = '';

    const fileToUpload = selectedFile;
    const reader = new FileReader();
    reader.onerror = () => {
      isUploading = false;
      alertType = 'error';
      alertMessage = 'Failed to read local firmware binary file.';
    };
    reader.onload = () => {
      try {
        const rawResult = reader.result as string;
        const base64Data = rawResult.includes(',') ? rawResult.split(',')[1] : rawResult;

        const payload = JSON.stringify({
          password: pwd,
          version: ver,
          channel: releaseChannel,
          description: releaseDescription.trim(),
          isStable: isStable,
          device: 'esp32-robot',
          data: base64Data
        });

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/firmware/upload', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            uploadedBytes = event.loaded;
            totalBytes = event.total;
            uploadProgress = Math.round((event.loaded / event.total) * 100);
          }
        };

        xhr.onload = () => {
          isUploading = false;
          try {
            const res = JSON.parse(xhr.responseText);
            if (xhr.status === 200 && res.success) {
              alertType = 'success';
              alertMessage = `Firmware v${ver} published successfully! Size: ${(res.manifest.size / 1024).toFixed(1)} KB${isStable ? ' [STABLE RELEASE]' : ''}`;
              selectedFile = null;
              releaseDescription = '';
              fetchExistingVersions();
            } else {
              alertType = 'error';
              alertMessage = res.error || res.message || 'Upload rejected by server.';
            }
          } catch (err: any) {
            alertType = 'error';
            alertMessage = `Server error (HTTP ${xhr.status}): ${xhr.statusText || err.message}`;
          }
        };

        xhr.onerror = () => {
          isUploading = false;
          alertType = 'error';
          alertMessage = 'Network error during upload. Ensure the backend server is running.';
        };

        xhr.send(payload);
      } catch (err: any) {
        isUploading = false;
        alertType = 'error';
        alertMessage = `Preparation error: ${err.message}`;
      }
    };
    reader.readAsDataURL(fileToUpload);
  }
</script>

<div class="upload-root">
  <!-- HUD Top Bar -->
  <header class="hud-topbar">
    <div class="topbar-left">
      <button type="button" class="btn-cockpit-back" onclick={handleGoHome}>
        <ArrowLeft size={15} strokeWidth={2.5} />
        <span>COCKPIT HUD</span>
      </button>
      <div class="hud-divider"></div>
      <div class="hud-brand">
        <div class="live-dot"></div>
        <span class="hud-title">FIRMWARE DISPATCH TERMINAL</span>
        <span class="hud-sub">SYS//OTA-ADMIN</span>
      </div>
    </div>

    <div class="topbar-right">
      <div class="hud-badge arch">
        <Cpu size={13} strokeWidth={2.5} />
        <span>ESP32-WROOM-32</span>
      </div>
      <div class="hud-badge security">
        <ShieldCheck size={13} strokeWidth={2.5} />
        <span>SECURE RELEASE PORTAL</span>
      </div>
    </div>
  </header>

  <!-- Main Scrollable Viewport -->
  <div class="hud-viewport">
    <div class="hud-grid">
      
      <!-- =========================================================
           LEFT COLUMN: INJECTION / UPLOAD FORM
           ========================================================= -->
      <section class="hud-panel main-panel">
        <div class="panel-header">
          <div class="panel-title-row">
            <div class="icon-chip primary">
              <UploadCloud size={16} strokeWidth={2.5} />
            </div>
            <div>
              <h2 class="panel-title">BINARY PAYLOAD INJECTION</h2>
              <p class="panel-desc">Deploy and register over-the-air firmware binary packages</p>
            </div>
          </div>
          <span class="panel-tag">OTA v4</span>
        </div>

        <form class="panel-body" action="/api/firmware/upload" method="post" onsubmit={handleSubmit}>
          
          <!-- Step 1: Security Token -->
          <div class="field-block">
            <div class="field-header">
              <label for="rc_firmware_admin_password" class="field-label">
                <Lock size={13} strokeWidth={2.5} class="text-orange" />
                <span>ADMIN AUTHORIZATION SECRET</span>
              </label>
              <span class="field-req">REQUIRED</span>
            </div>

            <!-- Hidden identifier field for autofill isolation -->
            <input 
              type="hidden" 
              id="rc_firmware_admin_username" 
              name="rc_firmware_admin_username" 
              value="firmware-admin" 
              autocomplete="username" 
            />

            <div class="input-wrap">
              <input 
                type={showPassword ? 'text' : 'password'}
                id="rc_firmware_admin_password"
                name="rc_firmware_admin_password"
                bind:value={adminPassword}
                placeholder="Enter server admin password"
                required
                autocomplete="current-password"
                class="hud-input password-input"
              />
              <button 
                type="button" 
                class="btn-toggle-eye" 
                onclick={() => showPassword = !showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {#if showPassword}
                  <EyeOff size={15} strokeWidth={2.2} />
                {:else}
                  <Eye size={15} strokeWidth={2.2} />
                {/if}
              </button>
            </div>
          </div>

          <!-- Step 2: Binary Dropzone -->
          <div class="field-block">
            <div class="field-header">
              <label for="rc_firmware_bin_file" class="field-label">
                <FileCode2 size={13} strokeWidth={2.5} class="text-orange" />
                <span>COMPILED BINARY PAYLOAD (.BIN)</span>
              </label>
              <span class="field-req">REQUIRED</span>
            </div>

            <div 
              class="cyber-dropzone"
              class:dragover={isDragging}
              class:has-file={selectedFile !== null}
              ondrop={handleDrop}
              ondragover={handleDragOver}
              ondragleave={handleDragLeave}
              role="region"
              aria-label="Binary Dropzone"
            >
              <input 
                type="file" 
                id="rc_firmware_bin_file" 
                name="rc_firmware_bin_file"
                accept=".bin" 
                onchange={handleFileInputChange} 
                class="hidden-file-input"
              />

              <!-- Chamfered Corner Decors -->
              <span class="corner tl"></span>
              <span class="corner tr"></span>
              <span class="corner bl"></span>
              <span class="corner br"></span>

              {#if selectedFile}
                <div class="file-loaded-view">
                  <div class="file-icon-box">
                    <FileCheck size={28} strokeWidth={2.5} class="text-green" />
                  </div>
                  <div class="file-details">
                    <span class="file-title">{selectedFile.name}</span>
                    <div class="file-meta-row">
                      <span class="meta-pill">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                      <span class="meta-pill">APPLICATION/OCTET-STREAM</span>
                      <span class="meta-pill ok">READY</span>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    class="btn-remove-file" 
                    onclick={removeSelectedFile}
                    title="Remove file"
                  >
                    <X size={15} strokeWidth={2.5} />
                  </button>
                </div>
              {:else}
                <div class="dropzone-idle-view">
                  <div class="idle-icon-wrap">
                    <UploadCloud size={30} strokeWidth={2.2} class="text-orange" />
                  </div>
                  <span class="idle-prompt">DROP COMPILED .BIN FILE HERE</span>
                  <span class="idle-sub">or click to browse local filesystem</span>
                  <span class="idle-hint">Arduino IDE &gt; Sketch &gt; Export Compiled Binary</span>
                </div>
              {/if}
            </div>

            {#if fileError}
              <div class="error-strip">
                <AlertTriangle size={13} strokeWidth={2.5} />
                <span>{fileError}</span>
              </div>
            {/if}
          </div>

          <!-- Step 3: Target SemVer & Release Channel -->
          <div class="form-row-grid">
            <!-- Target Version -->
            <div class="field-block">
              <div class="field-header">
                <label for="rc_firmware_version" class="field-label">
                  <Tag size={13} strokeWidth={2.5} class="text-orange" />
                  <span>TARGET VERSION (SEMVER)</span>
                </label>
                <div class="quick-helpers">
                  <button type="button" class="helper-chip" onclick={() => suggestNextVersion('patch')}>+Patch</button>
                  <button type="button" class="helper-chip" onclick={() => suggestNextVersion('minor')}>+Minor</button>
                </div>
              </div>
              <input 
                type="text" 
                id="rc_firmware_version" 
                name="rc_firmware_version"
                bind:value={targetVersion} 
                placeholder="e.g. 1.0.8"
                pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-.*)?$"
                required
                class="hud-input font-mono"
              />
            </div>

            <!-- Release Channel Selector -->
            <div class="field-block">
              <div class="field-header">
                <span class="field-label">
                  <Layers size={13} strokeWidth={2.5} class="text-orange" />
                  <span>RELEASE CHANNEL</span>
                </span>
              </div>
              <div class="channel-pills">
                <button 
                  type="button" 
                  class="pill-btn" 
                  class:active={releaseChannel === 'stable'}
                  onclick={() => releaseChannel = 'stable'}
                >
                  <span class="pill-dot stable"></span>
                  STABLE
                </button>
                <button 
                  type="button" 
                  class="pill-btn" 
                  class:active={releaseChannel === 'beta'}
                  onclick={() => releaseChannel = 'beta'}
                >
                  <span class="pill-dot beta"></span>
                  BETA
                </button>
                <button 
                  type="button" 
                  class="pill-btn" 
                  class:active={releaseChannel === 'dev'}
                  onclick={() => releaseChannel = 'dev'}
                >
                  <span class="pill-dot dev"></span>
                  DEV
                </button>
              </div>
            </div>
          </div>

          <!-- Step 4: Release Notes & New Features -->
          <div class="field-block">
            <div class="field-header">
              <label for="rc_firmware_description" class="field-label">
                <FileText size={13} strokeWidth={2.5} class="text-orange" />
                <span>RELEASE NOTES &amp; NEW FEATURES</span>
              </label>
              <span class="field-opt">OPTIONAL</span>
            </div>
            <textarea 
              id="rc_firmware_description" 
              name="rc_firmware_description"
              bind:value={releaseDescription} 
              placeholder="Describe new features, bug fixes, or enhancements in this release..."
              rows="2"
              class="hud-input hud-textarea font-mono"
            ></textarea>
          </div>

          <!-- Step 5: Promote to Stable Switch -->
          <label class="toggle-card" for="rc_firmware_promote_stable">
            <input type="checkbox" id="rc_firmware_promote_stable" name="rc_firmware_promote_stable" bind:checked={isStable} />
            <div class="toggle-box">
              <div class="toggle-switch-ui" class:checked={isStable}>
                <div class="toggle-knob"></div>
              </div>
            </div>
            <div class="toggle-text">
              <span class="toggle-title">PROMOTE AS LATEST STABLE RELEASE</span>
              <span class="toggle-desc">All connected RC Car clients will automatically receive an update notification to install this version.</span>
            </div>
          </label>

          <!-- Upload Live Streaming Progress -->
          {#if isUploading}
            <div class="upload-meter-box">
              <div class="meter-labels">
                <div class="meter-status">
                  <Loader2 size={14} strokeWidth={2.5} class="animate-spin text-orange" />
                  <span>TRANSMITTING BINARY PAYLOAD...</span>
                </div>
                <span class="meter-pct font-mono">{uploadProgress}%</span>
              </div>
              <div class="meter-track">
                <div class="meter-fill" style="width: {uploadProgress}%"></div>
              </div>
              <div class="meter-sub font-mono">
                <span>{(uploadedBytes / 1024).toFixed(1)} KB / {(totalBytes / 1024).toFixed(1)} KB</span>
                <span>STREAM: ACTIVE</span>
              </div>
            </div>
          {/if}

          <!-- Feedback Banners -->
          {#if alertMessage}
            <div class="hud-alert-banner {alertType}">
              {#if alertType === 'success'}
                <CheckCircle2 size={18} strokeWidth={2.5} class="shrink-0 text-green" />
              {:else}
                <AlertTriangle size={18} strokeWidth={2.5} class="shrink-0 text-red" />
              {/if}
              <div class="alert-content">
                <span class="alert-heading">{alertType === 'success' ? 'DISPATCH SUCCESSFUL' : 'TRANSMISSION ERROR'}</span>
                <span class="alert-desc">{alertMessage}</span>
              </div>
            </div>
          {/if}

          <!-- Submit Tactical Button -->
          <button type="submit" class="btn-dispatch-submit" disabled={isUploading}>
            {#if isUploading}
              <Loader2 size={18} strokeWidth={2.5} class="animate-spin" />
              <span>DISPATCHING PAYLOAD ({uploadProgress}%)...</span>
            {:else}
              <UploadCloud size={18} strokeWidth={2.5} />
              <span>UPLOAD &amp; PUBLISH FIRMWARE</span>
            {/if}
          </button>
        </form>
      </section>

      <!-- =========================================================
           RIGHT COLUMN: ACTIVE REPOSITORY RELEASES & SYSTEM STATS
           ========================================================= -->
      <aside class="hud-panel sidebar-panel">
        
        <!-- Registry Header -->
        <div class="panel-header">
          <div class="panel-title-row">
            <div class="icon-chip green">
              <HardDrive size={16} strokeWidth={2.5} />
            </div>
            <div>
              <h3 class="panel-title">ACTIVE REPOSITORY</h3>
              <p class="panel-desc">Published firmware images in storage</p>
            </div>
          </div>
          <button 
            type="button" 
            class="btn-refresh-list" 
            onclick={fetchExistingVersions} 
            disabled={isLoadingVersions}
            title="Refresh list"
          >
            <RefreshCw size={13} strokeWidth={2.5} class={isLoadingVersions ? 'animate-spin' : ''} />
          </button>
        </div>

        <!-- Search Bar -->
        <div class="search-wrap">
          <input 
            type="text" 
            bind:value={searchQuery} 
            placeholder="Search version or channel..." 
            class="hud-input search-input font-mono"
          />
        </div>

        <!-- Versions Stream List -->
        <div class="versions-feed">
          {#if isLoadingVersions && existingVersions.length === 0}
            <div class="feed-empty">
              <Loader2 size={22} strokeWidth={2.5} class="animate-spin text-orange" />
              <span>Loading firmware repository...</span>
            </div>
          {:else if filteredVersions.length === 0}
            <div class="feed-empty">
              <HardDrive size={28} strokeWidth={2} class="text-muted opacity-30" />
              <span>No firmware releases match query.</span>
            </div>
          {:else}
            {#each filteredVersions as ver, index (ver.version)}
              <div class="version-feed-item">
                <div class="item-top">
                  <div class="item-tag-box">
                    <span class="item-ver-name">v{ver.version}</span>
                    <span class="channel-pill {ver.channel || 'stable'}">{(ver.channel || 'stable').toUpperCase()}</span>
                    {#if index === 0}
                      <span class="latest-pill">LATEST</span>
                    {/if}
                  </div>
                  <a 
                    href="/firmware/esp32/{ver.version}/firmware.bin" 
                    download="firmware-{ver.version}.bin"
                    class="btn-item-download"
                    title="Download binary"
                  >
                    <DownloadCloud size={14} strokeWidth={2.5} />
                  </a>
                </div>

                <div class="item-meta-grid">
                  <span class="meta-item">
                    <HardDrive size={11} strokeWidth={2.5} />
                    {(ver.size / 1024).toFixed(1)} KB
                  </span>
                  {#if ver.releasedAt}
                    <span class="meta-item">
                      <Clock size={11} strokeWidth={2.5} />
                      {new Date(ver.releasedAt).toLocaleDateString()}
                    </span>
                  {/if}
                </div>

                {#if ver.description}
                  <div class="item-desc-box">
                    <span class="item-desc-text">{ver.description}</span>
                  </div>
                {/if}

                {#if ver.sha256}
                  <div class="sha-box">
                    <span class="sha-label">SHA256:</span>
                    <code class="sha-hash" title={ver.sha256}>{ver.sha256.substring(0, 16)}...</code>
                    <button 
                      type="button" 
                      class="btn-copy-sha" 
                      onclick={() => copyToClipboard(ver.sha256)}
                      title="Copy SHA-256 Checksum"
                    >
                      {#if copiedSha === ver.sha256}
                        <Check size={11} strokeWidth={2.5} class="text-green" />
                      {:else}
                        <Copy size={11} strokeWidth={2.5} />
                      {/if}
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>

        <!-- Telemetry Status Footer -->
        <div class="telemetry-footer">
          <div class="tele-item">
            <span class="tele-lbl">TOTAL PACKAGES</span>
            <span class="tele-val font-mono">{existingVersions.length}</span>
          </div>
          <div class="tele-item">
            <span class="tele-lbl">LATEST STABLE</span>
            <span class="tele-val font-mono text-orange">v{latestVersion}</span>
          </div>
          <div class="tele-item">
            <span class="tele-lbl">SERVER STATUS</span>
            <span class="tele-val font-mono text-green">ONLINE</span>
          </div>
        </div>
      </aside>

    </div>
  </div>
</div>

<style>
  /* ==========================================================================
     CYBERPUNK HUD DISPATCH TERMINAL - COMPACT SLEEK EDITION
     ========================================================================== */
  
  .upload-root {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    background-color: var(--bg-light, #f1f3f7);
    background-image: 
      linear-gradient(rgba(15, 23, 42, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px);
    background-size: 20px 20px;
    color: var(--text-dark, #0f172a);
    font-family: var(--font-rect, 'Chakra Petch', -apple-system, BlinkMacSystemFont, sans-serif);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 1000;
  }

  /* HUD Topbar - Compact */
  .hud-topbar {
    height: 42px;
    min-height: 42px;
    background: #090d16;
    border-bottom: 2px solid #1e293b;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    flex-shrink: 0;
    gap: 10px;
    z-index: 10;
  }

  .topbar-left, .topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-cockpit-back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    background: #1e293b;
    color: #f8fafc;
    border: 1px solid #334155;
    font-size: 0.65rem;
    font-weight: 800;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.4px;
    cursor: pointer;
    transition: all 0.12s ease;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  }

  .btn-cockpit-back:hover {
    background: #dc2626;
    border-color: #dc2626;
    color: #ffffff;
  }

  .btn-cockpit-back:active {
    transform: scale(0.96);
  }

  .hud-divider {
    width: 1px;
    height: 18px;
    background: #334155;
  }

  .hud-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .live-dot {
    width: 7px;
    height: 7px;
    background: #22c55e;
    border-radius: 50%;
    box-shadow: 0 0 6px #22c55e;
    flex-shrink: 0;
    animation: pulse 2s infinite ease-in-out;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }

  .hud-title {
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: #ffffff;
    font-family: var(--font-mono, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hud-sub {
    font-size: 0.55rem;
    font-weight: 800;
    color: #ea580c;
    font-family: var(--font-mono, monospace);
    background: rgba(234, 88, 12, 0.15);
    padding: 1px 5px;
    border: 1px solid rgba(234, 88, 12, 0.4);
    white-space: nowrap;
  }

  .hud-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    font-size: 0.58rem;
    font-weight: 800;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.4px;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .hud-badge.arch {
    background: #1e293b;
    color: #94a3b8;
    border-color: #334155;
  }

  .hud-badge.security {
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.4);
  }

  @media (max-width: 768px) {
    .hud-badge.arch, .hud-sub {
      display: none;
    }
  }

  @media (max-width: 480px) {
    .hud-badge.security {
      display: none;
    }
    .hud-divider {
      display: none;
    }
  }

  /* Viewport Layout */
  .hud-viewport {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    padding: 12px;
  }

  .hud-grid {
    max-width: 960px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 12px;
    align-items: start;
    padding-bottom: 16px;
  }

  @media (max-width: 860px) {
    .hud-grid {
      grid-template-columns: 1fr;
    }
    .hud-viewport {
      padding: 10px 8px;
    }
  }

  /* Compact Panels */
  .hud-panel {
    background: #ffffff;
    border: 1.5px solid #090d16;
    box-shadow: 3px 3px 0px #090d16;
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    background: #090d16;
    color: #ffffff;
    padding: 8px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1.5px solid #090d16;
  }

  .panel-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .icon-chip {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    flex-shrink: 0;
  }

  .icon-chip.primary {
    background: rgba(234, 88, 12, 0.2);
    color: #ea580c;
    border-color: rgba(234, 88, 12, 0.5);
  }

  .icon-chip.green {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.5);
  }

  .panel-title {
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.6px;
    font-family: var(--font-mono, monospace);
  }

  .panel-desc {
    font-size: 0.56rem;
    color: #94a3b8;
    margin-top: 1px;
    font-family: var(--font-mono, monospace);
  }

  .panel-tag {
    font-size: 0.55rem;
    font-weight: 800;
    background: #ea580c;
    color: #ffffff;
    padding: 1px 5px;
    font-family: var(--font-mono, monospace);
    flex-shrink: 0;
  }

  .panel-body {
    padding: 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Compact Form Fields */
  .field-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .field-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.62rem;
    font-weight: 800;
    color: #0f172a;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.4px;
  }

  .field-req {
    font-size: 0.54rem;
    font-weight: 800;
    color: #dc2626;
    font-family: var(--font-mono, monospace);
  }

  .field-opt {
    font-size: 0.54rem;
    font-weight: 800;
    color: #64748b;
    font-family: var(--font-mono, monospace);
  }

  .hud-textarea {
    min-height: 56px;
    resize: vertical;
    font-size: 0.74rem;
    line-height: 1.4;
    padding: 6px 10px;
  }

  .quick-helpers {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .helper-chip {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    font-size: 0.58rem;
    font-weight: 800;
    padding: 1px 6px;
    min-height: 20px;
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    transition: all 0.1s ease;
    user-select: none;
    -webkit-user-select: none;
  }

  .helper-chip:hover {
    background: #ea580c;
    color: #ffffff;
    border-color: #ea580c;
  }

  .helper-chip:active {
    transform: scale(0.95);
  }

  .input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .hud-input {
    width: 100%;
    min-height: 34px;
    padding: 6px 10px;
    background: #ffffff;
    border: 1.5px solid #090d16;
    font-size: 0.78rem;
    color: #0f172a;
    outline: none;
    transition: all 0.12s ease;
    user-select: text;
    -webkit-user-select: text;
    box-sizing: border-box;
  }

  .hud-input:focus {
    border-color: #ea580c;
    box-shadow: 2px 2px 0px rgba(234, 88, 12, 0.3);
  }

  .password-input {
    padding-right: 36px;
  }

  .btn-toggle-eye {
    position: absolute;
    right: 3px;
    top: 50%;
    transform: translateY(-50%);
    width: 30px;
    height: 30px;
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.12s ease;
  }

  .btn-toggle-eye:hover {
    color: #0f172a;
  }

  /* Compact Cyber Dropzone */
  .cyber-dropzone {
    position: relative;
    border: 1.5px dashed #94a3b8;
    background: #f8fafc;
    padding: 14px 10px;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .cyber-dropzone:hover,
  .cyber-dropzone.dragover {
    border-color: #ea580c;
    background: rgba(234, 88, 12, 0.04);
  }

  .cyber-dropzone.has-file {
    border-color: #22c55e;
    background: #f0fdf4;
    border-style: solid;
  }

  .hidden-file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    z-index: 2;
  }

  /* Corner Decors */
  .corner {
    position: absolute;
    width: 5px;
    height: 5px;
    border-color: #090d16;
    pointer-events: none;
  }
  .corner.tl { top: -2px; left: -2px; border-top: 1.5px solid; border-left: 1.5px solid; }
  .corner.tr { top: -2px; right: -2px; border-top: 1.5px solid; border-right: 1.5px solid; }
  .corner.bl { bottom: -2px; left: -2px; border-bottom: 1.5px solid; border-left: 1.5px solid; }
  .corner.br { bottom: -2px; right: -2px; border-bottom: 1.5px solid; border-right: 1.5px solid; }

  .dropzone-idle-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    pointer-events: none;
    text-align: center;
  }

  .idle-prompt {
    font-size: 0.74rem;
    font-weight: 800;
    color: #0f172a;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.2px;
  }

  .idle-sub {
    font-size: 0.60rem;
    color: #64748b;
    font-family: var(--font-mono, monospace);
  }

  .idle-hint {
    font-size: 0.54rem;
    color: #94a3b8;
    margin-top: 2px;
    font-family: var(--font-mono, monospace);
  }

  /* File Loaded View - Compact */
  .file-loaded-view {
    display: flex;
    align-items: center;
    gap: 10px;
    position: relative;
    z-index: 3;
  }

  .file-icon-box {
    width: 36px;
    height: 36px;
    background: #dcfce7;
    border: 1px solid #86efac;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .file-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .file-title {
    font-size: 0.76rem;
    font-weight: 800;
    color: #15803d;
    font-family: var(--font-mono, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .meta-pill {
    font-size: 0.55rem;
    font-weight: 800;
    padding: 1px 4px;
    background: #ffffff;
    border: 1px solid #bbf7d0;
    color: #166534;
    font-family: var(--font-mono, monospace);
  }

  .meta-pill.ok {
    background: #22c55e;
    color: #ffffff;
    border-color: #22c55e;
  }

  .btn-remove-file {
    width: 26px;
    height: 26px;
    background: #fee2e2;
    border: 1px solid #fca5a5;
    color: #dc2626;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.12s ease;
    flex-shrink: 0;
  }

  .btn-remove-file:hover {
    background: #dc2626;
    color: #ffffff;
  }

  .error-strip {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.62rem;
    font-weight: 800;
    color: #dc2626;
    font-family: var(--font-mono, monospace);
    margin-top: 3px;
  }

  /* Compact Form Row Grid */
  .form-row-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  @media (max-width: 540px) {
    .form-row-grid {
      grid-template-columns: 1fr;
    }
  }

  .channel-pills {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
  }

  .pill-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 34px;
    padding: 4px 6px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    font-size: 0.64rem;
    font-weight: 800;
    font-family: var(--font-mono, monospace);
    color: #475569;
    cursor: pointer;
    transition: all 0.1s ease;
    user-select: none;
    -webkit-user-select: none;
  }

  .pill-btn:hover {
    border-color: #090d16;
    color: #090d16;
  }

  .pill-btn:active {
    transform: scale(0.97);
  }

  .pill-btn.active {
    background: #090d16;
    border-color: #090d16;
    color: #ffffff;
  }

  .pill-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pill-dot.stable { background: #22c55e; }
  .pill-dot.beta { background: #eab308; }
  .pill-dot.dev { background: #3b82f6; }

  /* Compact Toggle Card */
  .toggle-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    cursor: pointer;
    transition: all 0.12s ease;
    user-select: none;
    -webkit-user-select: none;
  }

  .toggle-card:hover {
    border-color: #cbd5e1;
    background: #f1f5f9;
  }

  .toggle-card input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-box {
    flex-shrink: 0;
  }

  .toggle-switch-ui {
    width: 30px;
    height: 18px;
    background: #cbd5e1;
    border: 1px solid #090d16;
    position: relative;
    transition: background 0.12s ease;
  }

  .toggle-switch-ui.checked {
    background: #ea580c;
  }

  .toggle-knob {
    width: 12px;
    height: 12px;
    background: #ffffff;
    border: 1px solid #090d16;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.12s ease;
  }

  .toggle-switch-ui.checked .toggle-knob {
    transform: translateX(12px);
  }

  .toggle-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .toggle-title {
    font-size: 0.66rem;
    font-weight: 800;
    color: #0f172a;
    font-family: var(--font-mono, monospace);
  }

  .toggle-desc {
    font-size: 0.56rem;
    color: #64748b;
    line-height: 1.25;
  }

  /* Compact Upload Meter */
  .upload-meter-box {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meter-labels {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .meter-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.65rem;
    font-weight: 800;
    color: #ea580c;
    font-family: var(--font-mono, monospace);
  }

  .meter-pct {
    font-size: 0.72rem;
    font-weight: 800;
    color: #ea580c;
  }

  .meter-track {
    width: 100%;
    height: 6px;
    background: #ffedd5;
    border: 1px solid #fdba74;
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    background: #ea580c;
    transition: width 0.2s ease;
  }

  .meter-sub {
    display: flex;
    justify-content: space-between;
    font-size: 0.54rem;
    color: #9a3412;
  }

  /* Compact Alert Banner */
  .hud-alert-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid transparent;
  }

  .hud-alert-banner.success {
    background: #f0fdf4;
    border-color: #22c55e;
  }

  .hud-alert-banner.error {
    background: #fef2f2;
    border-color: #dc2626;
  }

  .alert-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .alert-heading {
    font-size: 0.66rem;
    font-weight: 800;
    font-family: var(--font-mono, monospace);
  }

  .hud-alert-banner.success .alert-heading { color: #16a34a; }
  .hud-alert-banner.error .alert-heading { color: #dc2626; }

  .alert-desc {
    font-size: 0.60rem;
    font-weight: 700;
    color: #334155;
    font-family: var(--font-mono, monospace);
    line-height: 1.25;
  }

  /* Sleek Compact Submit Button */
  .btn-dispatch-submit {
    width: 100%;
    min-height: 38px;
    padding: 8px 16px;
    background: #ea580c;
    color: #ffffff;
    border: 1.5px solid #090d16;
    box-shadow: 2.5px 2.5px 0px #090d16;
    font-size: 0.78rem;
    font-weight: 900;
    letter-spacing: 0.6px;
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    transition: all 0.1s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    user-select: none;
    -webkit-user-select: none;
  }

  .btn-dispatch-submit:hover:not(:disabled) {
    background: #c2410c;
    transform: translate(-1px, -1px);
    box-shadow: 3.5px 3.5px 0px #090d16;
  }

  .btn-dispatch-submit:active:not(:disabled) {
    transform: translate(1.5px, 1.5px);
    box-shadow: 1px 1px 0px #090d16;
  }

  .btn-dispatch-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  /* =========================================================
     SIDEBAR: REPOSITORY STREAM - COMPACT
     ========================================================= */

  .sidebar-panel {
    display: flex;
    flex-direction: column;
  }

  .btn-refresh-list {
    background: #1e293b;
    border: 1px solid #334155;
    color: #f8fafc;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.12s ease;
    flex-shrink: 0;
  }

  .btn-refresh-list:hover {
    background: #ea580c;
    border-color: #ea580c;
  }

  .search-wrap {
    padding: 6px 10px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .search-input {
    min-height: 30px;
    padding: 4px 8px;
    font-size: 0.70rem;
  }

  .versions-feed {
    max-height: 360px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
  }

  .feed-empty {
    padding: 24px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 0.68rem;
    color: #64748b;
    font-family: var(--font-mono, monospace);
    text-align: center;
  }

  .version-feed-item {
    padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    transition: background 0.1s ease;
  }

  .version-feed-item:last-child {
    border-bottom: none;
  }

  .version-feed-item:hover {
    background: #f8fafc;
  }

  .item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .item-tag-box {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .item-ver-name {
    font-size: 0.76rem;
    font-weight: 800;
    color: #0f172a;
    font-family: var(--font-mono, monospace);
  }

  .channel-pill {
    font-size: 0.52rem;
    font-weight: 800;
    padding: 1px 4px;
    font-family: var(--font-mono, monospace);
    border: 1px solid transparent;
  }

  .channel-pill.stable {
    background: #f0fdf4;
    color: #16a34a;
    border-color: #bbf7d0;
  }

  .channel-pill.beta {
    background: #fefce8;
    color: #ca8a04;
    border-color: #fef08a;
  }

  .channel-pill.dev {
    background: #f1f5f9;
    color: #64748b;
    border-color: #cbd5e1;
  }

  .latest-pill {
    font-size: 0.50rem;
    font-weight: 800;
    padding: 1px 4px;
    background: #ea580c;
    color: #ffffff;
    font-family: var(--font-mono, monospace);
  }

  .btn-item-download {
    width: 26px;
    height: 26px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.1s ease;
    flex-shrink: 0;
    text-decoration: none;
  }

  .btn-item-download:hover {
    background: #ea580c;
    color: #ffffff;
    border-color: #ea580c;
  }

  .item-meta-grid {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 0.58rem;
    color: #64748b;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
  }

  .item-desc-box {
    background: #f8fafc;
    border-left: 2px solid #ea580c;
    padding: 3px 6px;
    margin-top: 1px;
  }

  .item-desc-text {
    font-size: 0.58rem;
    color: #334155;
    font-family: var(--font-mono, monospace);
    line-height: 1.3;
    display: block;
    word-break: break-word;
  }

  .sha-box {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #f1f5f9;
    padding: 2px 6px;
    border: 1px solid #e2e8f0;
  }

  .sha-label {
    font-size: 0.52rem;
    font-weight: 800;
    color: #64748b;
    font-family: var(--font-mono, monospace);
  }

  .sha-hash {
    flex: 1;
    font-size: 0.56rem;
    color: #0f172a;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-copy-sha {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 4px;
    transition: color 0.1s ease;
  }

  .btn-copy-sha:hover {
    color: #ea580c;
  }

  /* Compact Telemetry Footer */
  .telemetry-footer {
    padding: 8px 10px;
    background: #090d16;
    border-top: 1.5px solid #090d16;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    text-align: center;
  }

  .tele-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .tele-lbl {
    font-size: 0.50rem;
    font-weight: 800;
    color: #94a3b8;
    font-family: var(--font-mono, monospace);
  }

  .tele-val {
    font-size: 0.68rem;
    font-weight: 800;
    color: #ffffff;
  }

  /* Utilities */
  .text-orange { color: #ea580c; }
  .text-green { color: #16a34a; }
  .text-red { color: #dc2626; }
  .shrink-0 { flex-shrink: 0; }
  .font-mono { font-family: var(--font-mono, monospace); }
  .animate-spin { animation: spin 1s linear infinite; }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
