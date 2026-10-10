<script lang="ts">
  import { onMount } from 'svelte';

  const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v4.0.0';

  let progress = $state(0);
  let isReady = $state(false);
  let statusText = $state('INITIALIZING AVIONICS HARDWARE...');

  const INIT_STEPS = [
    {
      label: 'CHECKING BLUETOOTH & SECURE CONTEXT...',
      targetPct: 25,
      delayMs: 450,
      run: async () => {
        const hasBle = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
        const isSecure = typeof window !== 'undefined' && window.isSecureContext;
        return hasBle && isSecure;
      }
    },
    {
      label: 'LOADING HIGH-CONTRAST FONTS & ASSETS...',
      targetPct: 50,
      delayMs: 450,
      run: async () => {
        if (typeof document !== 'undefined' && 'fonts' in document) {
          try {
            await document.fonts.ready;
          } catch {}
        }
        return true;
      }
    },
    {
      label: 'CALIBRATING TOUCH ENGINE & CONTROLS...',
      targetPct: 75,
      delayMs: 450,
      run: async () => {
        return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
      }
    },
    {
      label: 'INITIALIZING RADAR HUD & GPU ENGINE...',
      targetPct: 90,
      delayMs: 450,
      run: async () => {
        const canvas = document.createElement('canvas');
        return !!canvas.getContext('2d');
      }
    },
    {
      label: 'AVIONICS READY • COCKPIT ONLINE',
      targetPct: 100,
      delayMs: 400,
      run: async () => true
    }
  ];

  onMount(() => {
    let cancelled = false;

    async function executeInitSequence() {
      for (const step of INIT_STEPS) {
        if (cancelled) break;
        statusText = step.label;
        try {
          await step.run();
        } catch {}
        
        progress = step.targetPct;
        await new Promise((resolve) => setTimeout(resolve, step.delayMs));
      }

      if (!cancelled) {
        progress = 100;
        statusText = `ALL SYSTEMS ONLINE (${APP_VERSION})`;
        setTimeout(() => {
          isReady = true;
        }, 300);
      }
    }

    executeInitSequence();

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="loading-screen {isReady ? 'hidden' : ''}">
  <div class="loading-card">
    <div class="loading-logo-box">
      <img src="/logo.svg" alt="ESP-RC Logo" class="loading-icon" />
      <div class="logo-pulse-ring"></div>
    </div>

    <h1 class="loading-title">ESP-RC</h1>
    <span class="loading-subtitle">HIGH PERFORMANCE COCKPIT • {APP_VERSION}</span>

    <div class="loading-bar-wrap">
      <div class="loading-bar-fill" style="width: {progress}%;"></div>
    </div>

    <div class="loading-status-row">
      <span class="loading-status-text">{statusText}</span>
      <span class="loading-pct-text">{progress}%</span>
    </div>
  </div>
</div>
