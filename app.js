/**
 * ============================================================================
 * ESP32 Web Bluetooth RC Car - Cyber Cockpit Controller Engine
 * Architecture: Landscape Mech / Black & Red Light Theme
 * ============================================================================
 */

// Nordic Semiconductor UART Service UUIDs
const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_RX_CHAR_UUID      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write to ESP32
const NORDIC_TX_CHAR_UUID      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify from ESP32

class WebBluetoothRC {
  constructor() {
    this.device = null;
    this.server = null;
    this.rxChar = null;
    this.txChar = null;

    this.isConnected = false;
    this.isConnecting = false;
    this.autoReconnect = true;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    // Transmission throttling & queue
    this.lastSentCommand = null;
    this.lastSentTimestamp = 0;
    this.minSendIntervalMs = 25; // Max 40Hz to prevent BLE buffer congestion
    this.pendingCommand = null;
    this.sendTimer = null;
    this.pingStartTime = 0;

    // Telemetry & State
    this.currentSpeed = 200;
    this.headlightsOn = false;
    this.activeMovement = 'S'; // Default STOP
    this.driveMode = 'MANUAL'; // 'MANUAL' | 'AUTOMATIC'

    this.initElements();
    this.initLoadingScreen();
    this.initEventListeners();
    this.registerServiceWorker();
    this.initGamepadLoop();
  }

  initElements() {
    this.el = {
      // Loading Screen
      loadingScreen: document.getElementById('loadingScreen'),
      loadingProgress: document.getElementById('loadingProgress'),
      loadingStatus: document.getElementById('loadingStatus'),

      // Top Bar
      btnConnect: document.getElementById('btnConnect'),
      btnDisconnect: document.getElementById('btnDisconnect'),
      statusBadge: document.getElementById('statusBadge'),
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      valLatency: document.getElementById('valLatency'),
      valDriveMode: document.getElementById('valDriveMode'),
      valUptime: document.getElementById('valUptime'),
      toggleLights: document.getElementById('toggleLights'),
      toggleHorn: document.getElementById('toggleHorn'),

      // Left Driving Panel
      btnModeManual: document.getElementById('btnModeManual'),
      btnModeAutoAvoid: document.getElementById('btnModeAutoAvoid'),
      typeTabs: document.querySelectorAll('.type-tab'),
      joystickControls: document.getElementById('joystickControls'),
      dpadControls: document.getElementById('dpadControls'),
      differentialControls: document.getElementById('differentialControls'),

      // Joystick Elements
      joystickBase: document.getElementById('joystickBase'),
      joystickStick: document.getElementById('joystickStick'),

      // Tank / Differential Elements
      leftTrack: document.getElementById('leftTrack'),
      leftThumb: document.getElementById('leftThumb'),
      rightTrack: document.getElementById('rightTrack'),
      rightThumb: document.getElementById('rightThumb'),
      leftTrackVal: document.getElementById('leftTrackVal'),
      rightTrackVal: document.getElementById('rightTrackVal'),

      // Center Elements
      valDistance: document.getElementById('valDistance'),
      radarBar: document.getElementById('radarBar'),
      speedSlider: document.getElementById('speedSlider'),
      pwmValueDisplay: document.getElementById('pwmValueDisplay'),
      btnEmergencyStop: document.getElementById('btnEmergencyStop'),

      // Right Elements (Minimap & Logs)
      minimapBox: document.getElementById('minimapBox'),
      terminalLog: document.getElementById('terminalLog')
    };
  }

  // ==========================================================================
  // Loading Screen Animation
  // ==========================================================================

  initLoadingScreen() {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 25) + 15;
      if (progress > 100) progress = 100;
      
      if (this.el.loadingProgress) {
        this.el.loadingProgress.style.width = `${progress}%`;
      }
      
      if (progress >= 100) {
        clearInterval(interval);
        if (this.el.loadingStatus) this.el.loadingStatus.textContent = 'SYSTEM READY';
        setTimeout(() => {
          if (this.el.loadingScreen) {
            this.el.loadingScreen.classList.add('hidden');
          }
        }, 350);
      }
    }, 90);
  }

  // ==========================================================================
  // Logging with Linear Opacity Scroller
  // ==========================================================================

  log(msg, type = 'info') {
    if (!this.el.terminalLog) return;

    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toTimeString().split(' ')[0];
    line.textContent = `[${time}] ${msg}`;

    // Prepend so that in column-reverse, newest appears at bottom
    this.el.terminalLog.prepend(line);

    // Limit maximum lines to prevent DOM bloat
    if (this.el.terminalLog.children.length > 50) {
      this.el.terminalLog.removeChild(this.el.terminalLog.lastChild);
    }
  }

  updateConnectionUI(status) {
    if (status === 'connected') {
      this.isConnected = true;
      this.isConnecting = false;
      this.el.statusDot.className = 'status-dot connected';
      this.el.statusText.textContent = this.device ? (this.device.name || 'CONNECTED') : 'CONNECTED';
      this.el.btnConnect.style.display = 'none';
      this.el.btnDisconnect.style.display = 'inline-flex';
    } else if (status === 'connecting') {
      this.isConnected = false;
      this.isConnecting = true;
      this.el.statusDot.className = 'status-dot';
      this.el.statusText.textContent = 'CONNECTING...';
    } else {
      this.isConnected = false;
      this.isConnecting = false;
      this.el.statusDot.className = 'status-dot';
      this.el.statusText.textContent = 'DISCONNECTED';
      this.el.btnConnect.style.display = 'inline-flex';
      this.el.btnDisconnect.style.display = 'none';
      this.el.valLatency.textContent = '-- ms ping';
      this.el.valUptime.textContent = '00:00';
      this.el.valDistance.textContent = '-- cm';
      this.setDriveMode('MANUAL');
    }
  }

  setDriveMode(mode) {
    this.driveMode = mode;
    this.el.btnModeManual.classList.toggle('active', mode === 'MANUAL');
    this.el.btnModeAutoAvoid.classList.toggle('active', mode === 'AUTOMATIC');
    this.el.valDriveMode.textContent = mode;
  }

  // ==========================================================================
  // Web Bluetooth API Integration
  // ==========================================================================

  async connect() {
    if (!navigator.bluetooth) {
      this.log('Web Bluetooth is NOT supported. Use Chrome or Edge over HTTPS/localhost.', 'error');
      alert('Web Bluetooth API is not available in this browser. Please open Google Chrome over HTTPS or localhost.');
      return;
    }

    try {
      this.updateConnectionUI('connecting');
      this.log('Scanning for ESP32 BLE UART device...');

      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ESP32' },
          { namePrefix: 'RC' },
          { services: [NORDIC_UART_SERVICE_UUID] }
        ],
        optionalServices: [NORDIC_UART_SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));

      this.log(`Connecting to [${this.device.name || 'ESP32'}]...`);
      this.server = await this.device.gatt.connect();

      this.log('Discovering Nordic UART Service...');
      const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

      this.rxChar = await service.getCharacteristic(NORDIC_RX_CHAR_UUID);
      this.txChar = await service.getCharacteristic(NORDIC_TX_CHAR_UUID);

      await this.txChar.startNotifications();
      this.txChar.addEventListener('characteristicvaluechanged', this.handleNotifications.bind(this));

      this.reconnectAttempts = 0;
      this.updateConnectionUI('connected');
      this.log('Connected & synchronized with ESP32!', 'info');

      this.sendSpeed(this.currentSpeed);

    } catch (err) {
      this.log(`Connection Failed: ${err.message}`, 'error');
      this.updateConnectionUI('disconnected');
    }
  }

  async disconnect() {
    this.autoReconnect = false;
    if (this.device && this.device.gatt.connected) {
      this.log('Disconnecting GATT server...');
      await this.device.gatt.disconnect();
    }
    this.updateConnectionUI('disconnected');
  }

  onDisconnected(event) {
    this.log('Warning: BLE Server Disconnected!', 'error');
    this.updateConnectionUI('disconnected');

    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(2000 * this.reconnectAttempts, 8000);
      this.log(`Auto-reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay / 1000}s...`, 'info');
      
      setTimeout(async () => {
        if (!this.isConnected && this.device) {
          try {
            this.updateConnectionUI('connecting');
            this.server = await this.device.gatt.connect();
            const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
            this.rxChar = await service.getCharacteristic(NORDIC_RX_CHAR_UUID);
            this.txChar = await service.getCharacteristic(NORDIC_TX_CHAR_UUID);
            await this.txChar.startNotifications();
            this.txChar.addEventListener('characteristicvaluechanged', this.handleNotifications.bind(this));
            
            this.reconnectAttempts = 0;
            this.updateConnectionUI('connected');
            this.log('Reconnection successful!', 'info');
          } catch (e) {
            this.log(`Auto-reconnect failed: ${e.message}`, 'error');
            this.onDisconnected(null);
          }
        }
      }, delay);
    }
  }

  handleNotifications(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const message = decoder.decode(value).trim();

    if (this.pingStartTime > 0) {
      const rtt = Math.round(performance.now() - this.pingStartTime);
      this.el.valLatency.textContent = `${rtt} ms ping`;
      this.pingStartTime = 0;
    }

    // Parse packet: "T:<uptime>,<dist_cm>,<mode>"
    if (message.startsWith('T:')) {
      const parts = message.substring(2).split(',');
      if (parts.length >= 3) {
        const seconds = parseInt(parts[0], 10);
        const dist = parseInt(parts[1], 10);
        const mode = parts[2];

        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        this.el.valUptime.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;

        this.updateRadar(dist);

        if (mode === 'A' && this.driveMode !== 'AUTOMATIC') this.setDriveMode('AUTOMATIC');
        else if (mode === 'M' && this.driveMode !== 'MANUAL') this.setDriveMode('MANUAL');
      }
    } else {
      this.log(`ESP32: ${message}`);
    }
  }

  updateRadar(dist) {
    if (dist >= 300) {
      this.el.valDistance.textContent = '>300 cm';
      this.el.radarBar.style.width = '100%';
      this.el.radarBar.className = 'radar-fill';
    } else {
      this.el.valDistance.textContent = `${dist} cm`;
      const fillPct = Math.min(100, Math.max(8, (dist / 120) * 100));
      this.el.radarBar.style.width = `${fillPct}%`;

      if (dist <= 22) {
        this.el.radarBar.className = 'radar-fill danger';
      } else if (dist <= 40) {
        this.el.radarBar.className = 'radar-fill warning';
      } else {
        this.el.radarBar.className = 'radar-fill';
      }
    }
  }

  // ==========================================================================
  // Command Transmission & Non-Blocking Queue
  // ==========================================================================

  sendCommand(cmd, force = false) {
    if (!cmd) return;
    
    if (!force && cmd === this.lastSentCommand && (Date.now() - this.lastSentTimestamp) < 150) {
      return;
    }

    this.pendingCommand = cmd;

    const now = Date.now();
    const elapsed = now - this.lastSentTimestamp;

    if (elapsed >= this.minSendIntervalMs) {
      this.flushCommand();
    } else if (!this.sendTimer) {
      this.sendTimer = setTimeout(() => {
        this.sendTimer = null;
        this.flushCommand();
      }, this.minSendIntervalMs - elapsed);
    }
  }

  async flushCommand() {
    if (!this.pendingCommand) return;
    const cmd = this.pendingCommand;
    this.pendingCommand = null;
    this.lastSentCommand = cmd;
    this.lastSentTimestamp = Date.now();

    if (!this.isConnected || !this.rxChar) {
      return;
    }

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(cmd + '\n');
      this.pingStartTime = performance.now();

      if (this.rxChar.writeValueWithoutResponse) {
        await this.rxChar.writeValueWithoutResponse(data);
      } else {
        await this.rxChar.writeValue(data);
      }
    } catch (err) {
      this.log(`Transmit error: ${err.message}`, 'error');
    }
  }

  sendSpeed(val) {
    this.currentSpeed = val;
    const pct = Math.round((val / 255) * 100);
    this.el.pwmValueDisplay.textContent = `${val} (${pct}%)`;
    this.sendCommand(`V${val}`, true);
  }

  // ==========================================================================
  // UI & Controller Event Listeners
  // ==========================================================================

  initEventListeners() {
    // Bluetooth Pair / Unpair
    this.el.btnConnect.addEventListener('click', () => {
      this.autoReconnect = true;
      this.connect();
    });

    this.el.btnDisconnect.addEventListener('click', () => {
      this.disconnect();
    });

    // Drive Mode Buttons [MANUAL] & [AUTOMATIC]
    this.el.btnModeManual.addEventListener('click', () => {
      this.setDriveMode('MANUAL');
      this.sendCommand('a', true);
      this.log('Drive Mode: MANUAL', 'info');
    });

    this.el.btnModeAutoAvoid.addEventListener('click', () => {
      this.setDriveMode('AUTOMATIC');
      this.sendCommand('A', true);
      this.log('Drive Mode: AUTOMATIC (Obstacle Avoidance)', 'info');
    });

    // Control Type Tabs (Joystick / Buttons / Differential)
    this.el.typeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.el.typeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.mode;

        this.el.joystickControls.style.display = mode === 'joystick' ? 'flex' : 'none';
        this.el.dpadControls.style.display = mode === 'dpad' ? 'grid' : 'none';
        this.el.differentialControls.style.display = mode === 'differential' ? 'flex' : 'none';

        this.sendCommand('S', true);
      });
    });

    // Speed Slider
    this.el.speedSlider.addEventListener('input', (e) => {
      this.sendSpeed(parseInt(e.target.value, 10));
    });

    // Headlights Toggle
    this.el.toggleLights.addEventListener('click', () => {
      this.headlightsOn = !this.headlightsOn;
      this.el.toggleLights.classList.toggle('active', this.headlightsOn);
      this.sendCommand(this.headlightsOn ? 'W' : 'w', true);
    });

    // Horn (Momentary Button)
    const startHorn = (e) => {
      e.preventDefault();
      this.el.toggleHorn.classList.add('active');
      this.sendCommand('U', true);
    };
    const stopHorn = (e) => {
      e.preventDefault();
      this.el.toggleHorn.classList.remove('active');
      this.sendCommand('u', true);
    };
    this.el.toggleHorn.addEventListener('pointerdown', startHorn);
    this.el.toggleHorn.addEventListener('pointerup', stopHorn);
    this.el.toggleHorn.addEventListener('pointerleave', stopHorn);

    // Emergency Brake Button
    const triggerStop = (e) => {
      if (e) e.preventDefault();
      this.setDriveMode('MANUAL');
      this.activeMovement = 'S';
      this.sendCommand('S', true);
      this.clearDpadActiveStates();
      this.log('EMERGENCY STOP ENGAGED', 'error');
    };
    this.el.btnEmergencyStop.addEventListener('pointerdown', triggerStop);

    // Initialize Sub-controllers
    this.initDpadEvents();
    this.initJoystickEvents();
    this.initDifferentialEvents();
    this.initKeyboardEvents();
  }

  // ==========================================================================
  // D-PAD Buttons (Zero-Latency Multi-Touch)
  // ==========================================================================

  initDpadEvents() {
    const buttons = this.el.dpadControls.querySelectorAll('.d-btn');

    buttons.forEach(btn => {
      const cmd = btn.dataset.cmd;

      const handlePress = (e) => {
        e.preventDefault();
        if (this.driveMode !== 'MANUAL') {
          this.setDriveMode('MANUAL');
        }
        btn.classList.add('pressed');
        this.activeMovement = cmd;
        this.sendCommand(cmd, true);
        if (navigator.vibrate) navigator.vibrate(15);
      };

      const handleRelease = (e) => {
        e.preventDefault();
        btn.classList.remove('pressed');
        if (this.activeMovement === cmd) {
          this.activeMovement = 'S';
          this.sendCommand('S', true);
        }
      };

      btn.addEventListener('pointerdown', handlePress);
      btn.addEventListener('pointerup', handleRelease);
      btn.addEventListener('pointercancel', handleRelease);
      btn.addEventListener('pointerleave', handleRelease);
    });
  }

  clearDpadActiveStates() {
    const buttons = this.el.dpadControls.querySelectorAll('.d-btn');
    buttons.forEach(b => b.classList.remove('pressed'));
  }

  // ==========================================================================
  // Virtual Touch Joystick
  // ==========================================================================

  initJoystickEvents() {
    const base = this.el.joystickBase;
    const stick = this.el.joystickStick;
    const maxRadius = 55; // Max radius in px
    let activePointerId = null;

    const processJoystickMovement = (clientX, clientY) => {
      const rect = base.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > maxRadius) {
        dx = (dx / distance) * maxRadius;
        dy = (dy / distance) * maxRadius;
      }

      stick.style.transform = `translate(${dx}px, ${dy}px)`;

      const normX = dx / maxRadius;
      const normY = -dy / maxRadius;
      const deadzone = 0.25;

      let cmd = 'S';
      if (Math.abs(normX) < deadzone && Math.abs(normY) < deadzone) {
        cmd = 'S';
      } else {
        if (this.driveMode !== 'MANUAL') {
          this.setDriveMode('MANUAL');
        }

        const angle = Math.atan2(normY, normX) * (180 / Math.PI);
        
        if (angle >= 67.5 && angle < 112.5) cmd = 'F';
        else if (angle >= 22.5 && angle < 67.5) cmd = 'I';
        else if (angle >= -22.5 && angle < 22.5) cmd = 'R';
        else if (angle >= -67.5 && angle < -22.5) cmd = 'J';
        else if (angle >= -112.5 && angle < -67.5) cmd = 'B';
        else if (angle >= -157.5 && angle < -112.5) cmd = 'H';
        else if (angle >= 112.5 && angle < 157.5) cmd = 'G';
        else cmd = 'L';
      }

      this.sendCommand(cmd);
    };

    const onPointerDown = (e) => {
      e.preventDefault();
      activePointerId = e.pointerId;
      base.setPointerCapture(activePointerId);
      processJoystickMovement(e.clientX, e.clientY);
    };

    const onPointerMove = (e) => {
      if (e.pointerId === activePointerId) {
        e.preventDefault();
        processJoystickMovement(e.clientX, e.clientY);
      }
    };

    const onPointerUp = (e) => {
      if (e.pointerId === activePointerId) {
        e.preventDefault();
        activePointerId = null;
        stick.style.transform = 'translate(0px, 0px)';
        this.sendCommand('S', true);
      }
    };

    base.addEventListener('pointerdown', onPointerDown);
    base.addEventListener('pointermove', onPointerMove);
    base.addEventListener('pointerup', onPointerUp);
    base.addEventListener('pointercancel', onPointerUp);
  }

  // ==========================================================================
  // Differential Tank Sliders
  // ==========================================================================

  initDifferentialEvents() {
    const setupTrack = (trackEl, thumbEl, valEl) => {
      let activePointer = null;
      const trackHeight = 120;
      const halfThumb = 15;
      const maxTravel = (trackHeight / 2) - halfThumb;

      const updateThumb = (clientY) => {
        const rect = trackEl.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        let dy = clientY - centerY;
        dy = Math.max(-maxTravel, Math.min(maxTravel, dy));

        thumbEl.style.top = `calc(50% - ${halfThumb}px + ${dy}px)`;
        const normalized = -Math.round((dy / maxTravel) * 255);
        valEl.textContent = normalized;
        return normalized;
      };

      const resetThumb = () => {
        thumbEl.style.top = `calc(50% - ${halfThumb}px)`;
        valEl.textContent = '0';
      };

      trackEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.driveMode !== 'MANUAL') this.setDriveMode('MANUAL');
        activePointer = e.pointerId;
        trackEl.setPointerCapture(activePointer);
        updateThumb(e.clientY);
        this.syncDifferentialCommand();
      });

      trackEl.addEventListener('pointermove', (e) => {
        if (e.pointerId === activePointer) {
          e.preventDefault();
          updateThumb(e.clientY);
          this.syncDifferentialCommand();
        }
      });

      const onEnd = (e) => {
        if (e.pointerId === activePointer) {
          e.preventDefault();
          activePointer = null;
          resetThumb();
          this.syncDifferentialCommand();
        }
      };

      trackEl.addEventListener('pointerup', onEnd);
      trackEl.addEventListener('pointercancel', onEnd);
    };

    setupTrack(this.el.leftTrack, this.el.leftThumb, this.el.leftTrackVal);
    setupTrack(this.el.rightTrack, this.el.rightThumb, this.el.rightTrackVal);
  }

  syncDifferentialCommand() {
    const left = parseInt(this.el.leftTrackVal.textContent, 10) || 0;
    const right = parseInt(this.el.rightTrackVal.textContent, 10) || 0;

    if (left === 0 && right === 0) {
      this.sendCommand('S');
    } else {
      this.sendCommand(`D:${left},${right}`);
    }
  }

  // ==========================================================================
  // Keyboard Controls
  // ==========================================================================

  initKeyboardEvents() {
    const keysDown = new Set();

    const computeKeyDirection = () => {
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
    };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }

      if (e.code === 'Space') {
        this.setDriveMode('MANUAL');
        this.sendCommand('S', true);
        return;
      }

      if (this.driveMode !== 'MANUAL') {
        this.setDriveMode('MANUAL');
      }

      keysDown.add(e.code);
      const cmd = computeKeyDirection();
      this.sendCommand(cmd, true);
    });

    window.addEventListener('keyup', (e) => {
      if (keysDown.has(e.code)) {
        keysDown.delete(e.code);
        const cmd = computeKeyDirection();
        this.sendCommand(cmd, true);
      }
    });
  }

  // ==========================================================================
  // Gamepad API Support
  // ==========================================================================

  initGamepadLoop() {
    const pollGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0];

      if (gp && this.isConnected) {
        const deadzone = 0.25;
        const axisX = gp.axes[0] || 0;
        const axisY = gp.axes[1] || 0;

        let cmd = 'S';
        if (Math.abs(axisX) > deadzone || Math.abs(axisY) > deadzone) {
          if (this.driveMode !== 'MANUAL') this.setDriveMode('MANUAL');

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

        if (gp.buttons[0] && gp.buttons[0].pressed) {
          this.setDriveMode('MANUAL');
          cmd = 'S';
        }

        this.sendCommand(cmd);
      }

      requestAnimationFrame(pollGamepad);
    };

    requestAnimationFrame(pollGamepad);
  }

  // ==========================================================================
  // PWA Service Worker Registration
  // ==========================================================================

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            this.log(`Service Worker active: ${reg.scope}`);
          })
          .catch((err) => {
            this.log(`Service Worker err: ${err.message}`, 'error');
          });
      });
    }
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.rcController = new WebBluetoothRC();
});
