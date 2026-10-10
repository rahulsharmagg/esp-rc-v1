import type { 
  DriveMode, 
  LogEntry, 
  WifiNetwork, 
  WifiStatus,
  OtaStatus,
  FirmwareVersionInfo,
  FirmwareLatestResponse,
  FirmwareVersionsResponse
} from './types';

const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class BLEController {
  // Connection State
  isConnected = $state(false);
  isConnecting = $state(false);
  deviceName = $state('DISCONNECTED');
  latency = $state(0);

  // Direct LAN Wi-Fi WebSocket Link
  isWifiWsConnected = $state(false);
  isConnectingWifiWs = $state(false);
  private wifiWs: WebSocket | null = null;
  activeConnectionMode = $derived<'BLE' | 'LAN' | 'HYBRID' | 'OFFLINE'>(
    this.isConnected && this.isWifiWsConnected ? 'HYBRID' :
    this.isWifiWsConnected ? 'LAN' :
    this.isConnected ? 'BLE' : 'OFFLINE'
  );

  // Telemetry
  uptime = $state('00:00');
  driveMode = $state<DriveMode>('MANUAL');
  batteryPct = $state(-1);
  batteryVolts = $state(0.0);
  hasBattery = $derived(this.batteryPct >= 0 && this.batteryVolts >= 5.0);
  distance = $state(300);
  irLeft = $state(false);
  irRight = $state(false);
  servoAngle = $state(90);

  // Actuator & Driving
  currentSpeed = $state(200);
  preTurboSpeed = $state(200);
  isTurbo = $state(false);
  isLightsOn = $state(false);
  isHornOn = $state(false);

  // Logs
  logs = $state<LogEntry[]>([]);
  private nextLogId = 0;

  // Preferences
  hapticEnabled = $state(true);
  wakeLockEnabled = $state(true);
  wakeLockActive = $state(false);
  private wakeLockSentinel: any = null;

  // Hardware Sensor On/Off Toggles
  ultrasonicEnabled = $state(true);
  irLeftEnabled = $state(true);
  irRightEnabled = $state(true);
  servoEnabled = $state(true);

  setSensorEnabled(sensor: 'ultrasonic' | 'irLeft' | 'irRight' | 'servo', enabled: boolean) {
    if (sensor === 'ultrasonic') {
      this.ultrasonicEnabled = enabled;
      this.sendCommand(enabled ? 'E:US:1' : 'E:US:0', true);
      this.log(`Ultrasonic Ranger ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
    } else if (sensor === 'irLeft') {
      this.irLeftEnabled = enabled;
      this.sendCommand(enabled ? 'E:IRL:1' : 'E:IRL:0', true);
      this.log(`Left IR Sensor ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
    } else if (sensor === 'irRight') {
      this.irRightEnabled = enabled;
      this.sendCommand(enabled ? 'E:IRR:1' : 'E:IRR:0', true);
      this.log(`Right IR Sensor ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
    } else if (sensor === 'servo') {
      this.servoEnabled = enabled;
      this.sendCommand(enabled ? 'E:SRV:1' : 'E:SRV:0', true);
      this.log(`Radar Servo Gimbal ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
    }
    this.vibrate(10);
  }

  // Wi-Fi State
  wifi = $state<WifiStatus>({
    enabled: false,
    connected: false,
    ssid: '',
    ip: '0.0.0.0',
    rssi: 0
  });
  wifiNetworks = $state<WifiNetwork[]>([]);
  isScanningWifi = $state(false);

  // OTA Firmware Update State
  otaStatus = $state<OtaStatus>('IDLE');
  otaProgress = $state(0);
  otaMessage = $state('');
  currentFirmwareVer = $state('1.0.2');
  latestFirmwareVer = $state('1.0.2');
  targetFlashingVersion = $state<string>('');
  hasFirmwareUpdate = $state(false);
  latestFirmwareDescription = $state<string>('');
  availableVersions = $state<FirmwareVersionInfo[]>([]);
  selectedVersion = $state<string>('');
  isCheckingFirmware = $state(false);

  // Internal Bluetooth primitives
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;

  // Transmission Rate Limiting & Queue
  private pendingCommand: string | null = null;
  private lastSentCommand: string = '';
  private lastSentTimestamp: number = 0;
  private minSendIntervalMs: number = 40;
  private sendTimer: any = null;
  private pingStartTime: number = 0;

  // Minimap callback hook
  onMovementChange?: (cmd: string, speed: number) => void;

  constructor() {
    if (typeof window !== 'undefined') {
      const savedHaptic = localStorage.getItem('esp32_rc_haptic');
      if (savedHaptic !== null) {
        this.hapticEnabled = savedHaptic !== 'false';
      }
      const savedWakeLock = localStorage.getItem('esp32_rc_wakelock');
      if (savedWakeLock !== null) {
        this.wakeLockEnabled = savedWakeLock !== 'false';
      }
    }
  }

  async requestWakeLock() {
    if (!this.wakeLockEnabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return;
    }
    try {
      if (this.wakeLockSentinel && !this.wakeLockSentinel.released) {
        this.wakeLockActive = true;
        return;
      }
      this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      this.wakeLockActive = true;
      this.wakeLockSentinel.addEventListener('release', () => {
        this.wakeLockActive = false;
      });
      this.log('💡 Screen Wake Lock active (Always On)', 'info');
    } catch (err: any) {
      this.wakeLockActive = false;
      // Many mobile browsers silently fail if page is not visible or user hasn't interacted yet
      console.warn('[WakeLock] Could not acquire lock:', err.message);
    }
  }

  async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (err) {
        // ignore
      }
      this.wakeLockSentinel = null;
    }
    this.wakeLockActive = false;
  }

  setWakeLock(enable: boolean) {
    this.wakeLockEnabled = enable;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('esp32_rc_wakelock', enable.toString());
    }
    if (enable) {
      this.requestWakeLock();
    } else {
      this.releaseWakeLock();
      this.log('Screen Wake Lock disabled', 'info');
    }
  }

  setHaptic(enable: boolean) {
    this.hapticEnabled = enable;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('esp32_rc_haptic', enable.toString());
    }
    if (enable) {
      this.vibrate(20);
    }
  }

  log(msg: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') {
    const time = new Date().toTimeString().split(' ')[0];
    const entry: LogEntry = {
      id: ++this.nextLogId,
      timestamp: time,
      message: msg,
      type
    };
    this.logs = [entry, ...this.logs.slice(0, 49)];
  }

  vibrate(pattern: number | number[]) {
    if (!this.hapticEnabled) return;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        if (navigator.userActivation && !navigator.userActivation.isActive && !navigator.userActivation.hasBeenActive) {
          return;
        }
        navigator.vibrate(pattern);
      }
    } catch (_) {}
  }

  async connect() {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      this.log('Web Bluetooth is not supported in this browser. Use Chrome/Edge over HTTPS.', 'error');
      alert('Web Bluetooth API is not available. Please open Chrome or Edge over HTTPS or localhost.');
      return;
    }

    try {
      this.isConnecting = true;
      this.log('Scanning for ESP32 BLE UART device...');

      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ESP32' },
          { namePrefix: 'RC' },
          { services: [NORDIC_UART_SERVICE_UUID] }
        ],
        optionalServices: [NORDIC_UART_SERVICE_UUID, 'device_information', 0x180a]
      });

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnected());

      this.log(`Connecting to GATT Server [${this.device.name || 'ESP32'}]...`);
      this.server = await this.device.gatt!.connect();

      // Read standard Device Information Service (UUID 0x180A) if present
      try {
        const disService = await this.server.getPrimaryService(0x180a);
        if (disService) {
          const fwChar = await disService.getCharacteristic(0x2a26); // Firmware Revision
          if (fwChar) {
            const fwVal = await fwChar.readValue();
            const fwStr = new TextDecoder().decode(fwVal).trim();
            if (fwStr) {
              this.currentFirmwareVer = fwStr;
              this.log(`Device reported Firmware: v${fwStr} via DIS`, 'info');
            }
          }
        }
      } catch (_) {
        // Fallback to UART query if DIS read fails
      }

      this.log('Accessing Nordic UART Primary Service...');
      const service = await this.server.getPrimaryService(NORDIC_UART_SERVICE_UUID);

      this.log('Locating RX & TX Characteristics...');
      this.rxChar = await service.getCharacteristic(NORDIC_UART_RX_CHAR_UUID);
      this.txChar = await service.getCharacteristic(NORDIC_UART_TX_CHAR_UUID);

      this.log('Subscribing to TX Telemetry Notifications...');
      await this.txChar.startNotifications();
      this.txChar.addEventListener('characteristicvaluechanged', (e: Event) => this.handleTelemetryNotification(e));

      this.isConnected = true;
      this.isConnecting = false;
      this.deviceName = this.device.name || 'CONNECTED';
      this.log(`Connected to ${this.deviceName} successfully!`, 'success');
      this.vibrate([30, 40, 30]);

      // Sync initial speed, mode, firmware version, and Wi-Fi status
      this.sendSpeed(this.currentSpeed);
      this.setDriveMode('MANUAL');
      this.sendCommand('OTA:VERSION', true);
      this.sendCommand('WIFI:STATUS', true);
    } catch (err: any) {
      this.isConnecting = false;
      this.isConnected = false;
      this.log(`Connection failed: ${err.message}`, 'error');
    }
  }

  async disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.log('Disconnecting from ESP32...');
      this.sendCommand('S', true);
      this.device.gatt.disconnect();
    }
    this.handleDisconnected();
  }

  private handleDisconnected() {
    this.isConnected = false;
    this.isConnecting = false;
    this.deviceName = 'DISCONNECTED';
    this.latency = 0;
    this.uptime = '00:00';
    this.distance = 300;
    this.log('ESP32 Bluetooth Disconnected', 'warn');
    this.vibrate([100, 50, 100]);

    if (this.otaStatus === 'UPDATING') {
      this.otaProgress = 85;
      this.otaMessage = 'ESP32 is downloading and flashing over Wi-Fi. It will auto-reboot in ~15-20s. Click RECONNECT once rebooted.';
      this.log('ℹ️ BLE disconnected while ESP32 streams firmware over Wi-Fi. Reconnect once ESP32 reboots.', 'info');
    }
  }

  connectWifiLan(targetIp?: string) {
    const ip = targetIp || this.wifi.ip;
    if (!ip || ip === '0.0.0.0') {
      this.log('Cannot connect LAN WebSocket: ESP32 has no valid IP address', 'error');
      return;
    }
    if (this.wifiWs) {
      this.wifiWs.close();
      this.wifiWs = null;
    }

    try {
      this.isConnectingWifiWs = true;
      const wsUrl = `ws://${ip}:81`;
      this.log(`Connecting directly to ESP32 over Wi-Fi LAN [${wsUrl}]...`, 'info');
      this.wifiWs = new WebSocket(wsUrl);

      this.wifiWs.onopen = () => {
        this.isWifiWsConnected = true;
        this.isConnectingWifiWs = false;
        this.log(`✅ Direct Wi-Fi LAN Connected (${ip}:81)! Long-range control active.`, 'success');
        this.vibrate([30, 40, 30]);
        this.sendCommand('OTA:VERSION', true);
        this.sendCommand('WIFI:STATUS', true);
      };

      this.wifiWs.onmessage = (e) => {
        if (typeof e.data === 'string') {
          this.handleIncomingMessage(e.data.trim());
        }
      };

      this.wifiWs.onerror = () => {
        this.isConnectingWifiWs = false;
        this.log(`Could not connect LAN WebSocket to ${ip}:81.`, 'warn');
      };

      this.wifiWs.onclose = () => {
        this.isWifiWsConnected = false;
        this.isConnectingWifiWs = false;
        this.wifiWs = null;
        this.log('LAN Wi-Fi WebSocket disconnected.', 'info');
      };
    } catch (err: any) {
      this.isConnectingWifiWs = false;
      this.log(`LAN WebSocket error: ${err.message}`, 'error');
    }
  }

  disconnectWifiLan() {
    if (this.wifiWs) {
      this.wifiWs.close();
      this.wifiWs = null;
    }
    this.isWifiWsConnected = false;
    this.isConnectingWifiWs = false;
  }

  private isWriting = false;

  sendCommand(cmd: string, force = false) {
    if (!cmd) return;

    if (this.onMovementChange && !cmd.startsWith('E:') && !cmd.startsWith('V') && !cmd.startsWith('P:') && !cmd.startsWith('WIFI:') && !cmd.startsWith('OTA:')) {
      this.onMovementChange(cmd, this.currentSpeed);
    }

    if (!force && cmd === this.lastSentCommand && (Date.now() - this.lastSentTimestamp) < 120) {
      return;
    }

    // 1. Direct Wi-Fi LAN WebSocket Transmission (Instant, <5ms latency)
    if (this.isWifiWsConnected && this.wifiWs && this.wifiWs.readyState === WebSocket.OPEN) {
      try {
        this.wifiWs.send(cmd);
      } catch (_) {}
    }

    // 2. Queue for Bluetooth Transmission if BLE is active
    if (this.isConnected && this.rxChar) {
      this.pendingCommand = cmd;
      const now = Date.now();
      const elapsed = now - this.lastSentTimestamp;

      if (elapsed >= this.minSendIntervalMs && !this.isWriting) {
        this.flushCommand();
      } else if (!this.sendTimer) {
        this.sendTimer = setTimeout(() => {
          this.sendTimer = null;
          this.flushCommand();
        }, Math.max(10, this.minSendIntervalMs - elapsed));
      }
    }
  }

  private async flushCommand() {
    if (!this.pendingCommand || this.isWriting) return;
    const cmd = this.pendingCommand;
    this.pendingCommand = null;
    this.lastSentCommand = cmd;
    this.lastSentTimestamp = Date.now();

    if (!this.isConnected || !this.rxChar) return;

    this.isWriting = true;
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(cmd + '\n');
      this.pingStartTime = performance.now();

      if (this.rxChar.writeValueWithoutResponse) {
        await this.rxChar.writeValueWithoutResponse(data);
      } else {
        await this.rxChar.writeValue(data);
      }
    } catch (err: any) {
      if (!err.message?.includes('already in progress')) {
        this.log(`Transmit error: ${err.message}`, 'error');
      }
    } finally {
      this.isWriting = false;
      if (this.pendingCommand) {
        setTimeout(() => this.flushCommand(), 10);
      }
    }
  }

  sendSpeed(val: number) {
    this.currentSpeed = Math.max(0, Math.min(255, val));
    this.sendCommand(`V${this.currentSpeed}`, true);
  }

  setDriveMode(mode: DriveMode) {
    this.driveMode = mode;
    this.sendCommand(mode === 'AUTOMATIC' ? 'X' : 'M', true);
    this.log(`Drive mode set to: ${mode}`, 'info');
  }

  toggleLights() {
    this.isLightsOn = !this.isLightsOn;
    this.sendCommand(this.isLightsOn ? 'W' : 'w', true);
    this.vibrate(15);
    this.log(`Headlights ${this.isLightsOn ? 'ON' : 'OFF'}`, 'info');
  }

  setHorn(on: boolean) {
    this.isHornOn = on;
    this.sendCommand(on ? 'U' : 'u', true);
    if (on) this.vibrate([20, 20]);
  }

  setServoAngle(angle: number) {
    const clamped = Math.max(0, Math.min(180, Math.round(angle)));
    this.servoAngle = clamped;
    this.sendCommand(`P:${clamped}`, true);
  }

  setTurbo(enable: boolean) {
    if (enable && !this.isTurbo) {
      this.isTurbo = true;
      this.preTurboSpeed = this.currentSpeed;
      this.sendSpeed(255);
      this.vibrate([40, 30, 40]);
      this.log('⚡ TURBO BOOST ENGAGED (255 PWM / 100%)', 'warn');
    } else if (!enable && this.isTurbo) {
      this.isTurbo = false;
      const restored = this.preTurboSpeed || 200;
      this.sendSpeed(restored);
      this.log(`⚡ Turbo released. Restored to ${restored} PWM`, 'info');
    }
  }

  // Wi-Fi commands
  setWifiPower(enable: boolean) {
    if (enable) {
      this.wifi.enabled = true;
      this.sendCommand('WIFI:ON', true);
      this.log('Wi-Fi Radio Enabled on ESP32', 'info');
      setTimeout(() => this.scanWifi(), 350);
    } else {
      this.wifi.enabled = false;
      this.wifi.connected = false;
      this.sendCommand('WIFI:OFF', true);
      this.log('Wi-Fi Radio Disabled (Battery Saver Mode)', 'warn');
    }
  }

  scanWifi() {
    if (!this.wifi.enabled) this.setWifiPower(true);
    this.isScanningWifi = true;
    this.sendCommand('WIFI:SCAN', true);
    this.log('Scanning 2.4GHz Wi-Fi airwaves...', 'info');

    if (!this.isConnected) {
      setTimeout(() => {
        this.isScanningWifi = false;
        this.wifiNetworks = [
          { ssid: 'Home_WiFi_2.4G', rssi: -48, isEncrypted: true },
          { ssid: 'ESP32_Test_Lab', rssi: -62, isEncrypted: true },
          { ssid: 'Open_Hotspot_Guest', rssi: -75, isEncrypted: false },
          { ssid: 'Workshop_AP', rssi: -83, isEncrypted: true }
        ];
      }, 800);
    }
  }

  startWifiScan() {
    this.scanWifi();
  }

  connectToWifi(ssid: string, pass: string) {
    this.log(`Connecting ESP32 to Wi-Fi SSID [${ssid}]...`, 'info');
    try {
      const b64Ssid = btoa(unescape(encodeURIComponent(ssid)));
      const b64Pass = pass ? btoa(unescape(encodeURIComponent(pass))) : '';
      this.sendCommand(`WIFI:CONNB:${b64Ssid}:${b64Pass}`, true);
    } catch (_) {
      this.sendCommand(`WIFI:CONN:${ssid}:${pass}`, true);
    }
  }

  disconnectWifi() {
    this.sendCommand('WIFI:DISC', true);
    this.log('Disconnecting ESP32 from Wi-Fi AP...', 'warn');
  }

  autoConnectWifi() {
    this.sendCommand('WIFI:AUTO', true);
    this.log('Requesting ESP32 to auto-connect to saved Wi-Fi...', 'info');
  }

  clearSavedWifi() {
    this.sendCommand('WIFI:CLEAR', true);
    this.log('Clearing saved Wi-Fi credentials on ESP32...', 'warn');
  }

  // OTA Firmware Update & Version History Methods
  private isFetchingVersions = false;

  async checkFirmwareUpdate() {
    if (this.isCheckingFirmware) return;
    this.isCheckingFirmware = true;
    this.otaStatus = 'CHECKING';
    this.otaMessage = 'Querying firmware repository for releases...';
    this.log('Checking firmware backend API (/api/firmware/latest)...', 'info');

    if (this.isConnected) {
      this.sendCommand('OTA:VERSION', true);
    }

    try {
      // 1. Fetch latest stable release from backend API
      const latestRes = await fetch('/api/firmware/latest?device=esp32-robot', { cache: 'no-store' })
        .catch(() => null);

      if (latestRes && latestRes.ok) {
        const latest: FirmwareLatestResponse = await latestRes.json();
        if (latest && latest.version) {
          this.latestFirmwareVer = latest.version;
          this.latestFirmwareDescription = latest.description || '';
          this.hasFirmwareUpdate = this.latestFirmwareVer !== this.currentFirmwareVer;
          this.otaStatus = this.hasFirmwareUpdate ? 'AVAILABLE' : 'IDLE';
          this.otaMessage = this.hasFirmwareUpdate 
            ? `New stable firmware v${this.latestFirmwareVer} is available!`
            : `Firmware is up to date (v${this.currentFirmwareVer}).`;
        } else {
          this.hasFirmwareUpdate = false;
          this.latestFirmwareVer = this.currentFirmwareVer;
          this.latestFirmwareDescription = '';
          this.otaStatus = 'IDLE';
          this.otaMessage = `Firmware is up to date (v${this.currentFirmwareVer}).`;
        }
      }

      // 2. Fetch full version history list for rollback/downgrade selection
      await this.fetchFirmwareVersions();
    } catch (err: any) {
      this.otaStatus = 'IDLE';
      this.otaMessage = 'Firmware update server checked.';
    } finally {
      this.isCheckingFirmware = false;
    }
  }

  async fetchFirmwareVersions() {
    if (this.isFetchingVersions) return;
    this.isFetchingVersions = true;
    try {
      const res = await fetch('/api/firmware/versions?device=esp32-robot', { cache: 'no-store' });
      if (res.ok) {
        const data: FirmwareVersionsResponse = await res.json();
        if (data && Array.isArray(data.versions)) {
          this.availableVersions = data.versions;
          if (!this.selectedVersion && this.availableVersions.length > 0) {
            this.selectedVersion = this.availableVersions[0].version;
          }
        }
      }
    } catch (err: any) {
      this.log(`Could not load firmware version history: ${err.message}`, 'warn');
    } finally {
      this.isFetchingVersions = false;
    }
  }

  private cloudWs: WebSocket | null = null;
  private currentOtaSessionCode: string = '';

  private connectCloudWsForOta(sessionCode: string) {
    if (typeof window === 'undefined') return;
    if (this.cloudWs) {
      this.cloudWs.close();
      this.cloudWs = null;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host || 'rc.codeblaze.in';
      const wsUrl = `${protocol}//${host}/ws`;

      this.log(`Connecting to Cloud WebSocket Relay [${wsUrl}] for OTA Session [${sessionCode}]...`, 'info');
      this.cloudWs = new WebSocket(wsUrl);

      this.cloudWs.onopen = () => {
        this.log(`🔗 Connected to Cloud WS Relay. Subscribing to session: ${sessionCode}`, 'info');
        this.cloudWs?.send(JSON.stringify({
          type: 'REGISTER_SESSION',
          sessionCode,
          role: 'browser'
        }));
      };

      this.cloudWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'ESP_ATTACHED') {
            this.log(`ESP32 attached to OTA session [${sessionCode}]. Flash stream starting...`, 'info');
            this.otaStatus = 'UPDATING';
            this.otaProgress = Math.max(5, this.otaProgress);
            this.otaMessage = 'ESP32 connected to OTA session! Beginning binary stream...';
          } else if (data.type === 'OTA_START') {
            this.otaProgress = 5;
            this.otaStatus = 'UPDATING';
            this.otaMessage = data.message || 'ESP32 connected! Streaming firmware...';
            this.log(`📡 [WS OTA] ${this.otaMessage}`, 'info');
          } else if (data.type === 'OTA_PROGRESS') {
            this.otaProgress = Math.max(5, data.pct || 0);
            this.otaStatus = 'UPDATING';
            const kbSent = Math.round((data.bytesSent || 0) / 1024);
            const kbTotal = Math.round((data.totalSize || 0) / 1024);
            this.otaMessage = data.status === 'REBOOTING' || data.pct >= 100
              ? 'Flashing complete! ESP32 is rebooting...'
              : `Flashing over Wi-Fi: ${data.pct}%${kbTotal > 0 ? ` (${kbSent}KB / ${kbTotal}KB)` : ''}`;
            this.log(`📡 [WS OTA] ${data.pct}% - ${this.otaMessage}`, 'info');
          } else if (data.type === 'OTA_COMPLETE') {
            this.otaProgress = 100;
            this.otaStatus = 'SUCCESS';
            this.otaMessage = 'Firmware 100% written to Flash! ESP32 is rebooting...';
            this.log('✅ ESP32 Firmware OTA Complete! Rebooting...', 'success');
            this.vibrate([100, 50, 100, 50, 200]);
            if (this.cloudWs) {
              this.cloudWs.close();
              this.cloudWs = null;
            }
          } else if (data.type === 'OTA_ERROR') {
            this.otaStatus = 'ERROR';
            this.otaMessage = data.message || 'OTA Update Failed';
            this.log(`❌ OTA Streaming Error: ${this.otaMessage}`, 'error');
            if (this.cloudWs) {
              this.cloudWs.close();
              this.cloudWs = null;
            }
          }
        } catch (_) {}
      };

      this.cloudWs.onerror = (err) => {
        console.warn('[Cloud WS Error]', err);
      };

      this.cloudWs.onclose = () => {
        this.cloudWs = null;
      };
    } catch (err: any) {
      this.log(`Cloud WebSocket connection error: ${err.message}`, 'warn');
    }
  }

  startFirmwareUpdate(targetVersionOrUrl?: string) {
    if (!this.wifi.connected) {
      this.log('Cannot perform OTA: ESP32 is not connected to Wi-Fi!', 'error');
      this.otaStatus = 'ERROR';
      this.otaMessage = 'Connect ESP32 to Wi-Fi with internet/local access first.';
      return;
    }

    const versionToFlash = targetVersionOrUrl || this.selectedVersion || this.latestFirmwareVer;
    this.targetFlashingVersion = versionToFlash;
    this.otaStatus = 'UPDATING';
    this.otaProgress = 5;
    this.otaMessage = `Initiating Wi-Fi binary stream for v${versionToFlash}...`;
    this.log(`🚀 Initiating ESP32 Over-The-Air (OTA) Flash for firmware v${versionToFlash}...`, 'warn');
    this.vibrate([50, 50, 50]);

    // Generate unique session code for targeted WebSocket OTA progress routing
    const sessionCode = 'ota_' + Math.random().toString(36).substring(2, 8);
    this.currentOtaSessionCode = sessionCode;

    // Connect to Cloud WebSocket server for dedicated session progress
    this.connectCloudWsForOta(sessionCode);

    // Construct full download URL for ESP32
    let downloadUrl = versionToFlash;
    if (!versionToFlash.startsWith('http://') && !versionToFlash.startsWith('https://')) {
      let espOrigin = 'https://rc.codeblaze.in';
      if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
          espOrigin = `${window.location.protocol}//${hostname}${window.location.port ? `:${window.location.port}` : ''}`;
        }
      }
      downloadUrl = `${espOrigin}/firmware/esp32/${versionToFlash}/firmware.bin`;
    }

    // Send OTA update command with sessionCode: OTA:UPDATE:<url>:<sessionCode>
    this.sendCommand(`OTA:UPDATE:${downloadUrl}:${sessionCode}`, true);
  }

  // Handle incoming UART Telemetry & BLE Messages
  private handleTelemetryNotification(e: Event) {
    const char = e.target as BluetoothRemoteGATTCharacteristic;
    if (!char || !char.value) return;

    if (this.pingStartTime > 0) {
      this.latency = Math.round(performance.now() - this.pingStartTime);
      this.pingStartTime = 0;
    }

    const decoder = new TextDecoder('utf-8');
    const message = decoder.decode(char.value).trim();
    if (!message) return;
    this.handleIncomingMessage(message);
  }

  handleIncomingMessage(message: string) {
    if (!message) return;

    // 1. T:<uptime_sec>,<dist>,<ir_l>,<ir_r>,<servo>,<bat_pct>,<bat_v>,<mode>
    if (message.startsWith('T:')) {
      const parts = message.substring(2).split(',');
      if (parts.length >= 8) {
        const uptimeSec = parseInt(parts[0], 10) || 0;
        this.distance = parseInt(parts[1], 10) || 0;
        this.irLeft = parseInt(parts[2], 10) === 1;
        this.irRight = parseInt(parts[3], 10) === 1;
        this.servoAngle = parseInt(parts[4], 10) || 90;
        const rawBatPct = parseInt(parts[5], 10);
        this.batteryPct = isNaN(rawBatPct) ? -1 : rawBatPct;
        this.batteryVolts = parseFloat(parts[6]) || 0;
        const mode = parts[7];

        const m = Math.floor(uptimeSec / 60);
        const s = uptimeSec % 60;
        this.uptime = `${m}:${s < 10 ? '0' : ''}${s}`;

        if (mode === 'A' && this.driveMode !== 'AUTOMATIC') this.driveMode = 'AUTOMATIC';
        else if (mode === 'M' && this.driveMode !== 'MANUAL') this.driveMode = 'MANUAL';
      }
    } 
    // 2. Wi-Fi Scan Streaming & Batch Results
    else if (message.startsWith('WIFI_SCAN_START')) {
      this.isScanningWifi = true;
      this.wifiNetworks = [];
      this.log('Listening for Wi-Fi beacon packets from ESP32...', 'info');
    }
    else if (message.startsWith('WIFI_NETB:')) {
      const parts = message.substring(10).split(':');
      if (parts.length >= 3) {
        let ssid = parts[0];
        try {
          ssid = decodeURIComponent(escape(atob(parts[0])));
        } catch (_) {
          try { ssid = atob(parts[0]); } catch (_) {}
        }
        if (ssid.trim().length > 0) {
          const rssi = parseInt(parts[1], 10) || -80;
          const isEncrypted = parts[2] === '1';
          const existingIdx = this.wifiNetworks.findIndex(n => n.ssid === ssid);
          if (existingIdx !== -1) {
            this.wifiNetworks[existingIdx].rssi = rssi;
          } else {
            this.wifiNetworks.push({ ssid, rssi, isEncrypted });
          }
          this.wifiNetworks.sort((a, b) => b.rssi - a.rssi);
        }
      }
    }
    else if (message.startsWith('WIFI_NET:')) {
      const parts = message.substring(9).split(':');
      if (parts.length >= 3 && parts[0].trim().length > 0) {
        const ssid = parts[0];
        const rssi = parseInt(parts[1], 10) || -80;
        const isEncrypted = parts[2] === '1';

        const existingIdx = this.wifiNetworks.findIndex(n => n.ssid === ssid);
        if (existingIdx !== -1) {
          this.wifiNetworks[existingIdx].rssi = rssi;
        } else {
          this.wifiNetworks.push({ ssid, rssi, isEncrypted });
        }
        this.wifiNetworks.sort((a, b) => b.rssi - a.rssi);
      }
    }
    else if (message.startsWith('WIFI_SCAN_END')) {
      this.isScanningWifi = false;
      this.wifiNetworks.sort((a, b) => b.rssi - a.rssi);
      this.log(`Wi-Fi Scan Complete: ${this.wifiNetworks.length} network(s) found.`, 'success');
    }
    else if (message.startsWith('WIFI_SCAN:')) {
      this.isScanningWifi = false;
      const rest = message.substring(10);
      const colonIdx = rest.indexOf(':');
      if (colonIdx !== -1) {
        const data = rest.substring(colonIdx + 1);
        const items = data.split('|');
        const nets: WifiNetwork[] = [];
        items.forEach(item => {
          const p = item.split(',');
          if (p.length >= 2 && p[0].trim().length > 0) {
            nets.push({
              ssid: p[0],
              rssi: parseInt(p[1], 10) || 0,
              isEncrypted: p[2] === '1'
            });
          }
        });
        nets.sort((a, b) => b.rssi - a.rssi);
        this.wifiNetworks = nets;
        this.log(`Wi-Fi Scan: ${this.wifiNetworks.length} network(s) found.`, 'success');
      }
    }
    // 3. Wi-Fi Status Result
    else if (message.startsWith('WIFI_STATUS:')) {
      const parts = message.substring(12).split(':');
      const state = parts[0];
      const ip = parts[1] || '0.0.0.0';
      const rssi = parseInt(parts[2] || '0', 10);
      const ssid = parts.slice(3).join(':');

      if (state === 'OFF') {
        this.wifi = { enabled: false, connected: false, ssid: '', ip: '0.0.0.0', rssi: 0 };
        this.disconnectWifiLan();
      } else if (state === 'CONNECTED') {
        this.wifi = { enabled: true, connected: true, ssid, ip, rssi };
        this.log(`Wi-Fi Connected! IP: ${ip} (SSID: ${ssid})`, 'success');
        this.checkFirmwareUpdate();
        if (ip && ip !== '0.0.0.0' && !this.isWifiWsConnected && !this.isConnectingWifiWs) {
          this.connectWifiLan(ip);
        }
      } else {
        this.wifi = { enabled: true, connected: false, ssid: '', ip: '0.0.0.0', rssi: 0 };
        this.disconnectWifiLan();
      }
    }
    // 4. OTA Firmware Notification Handlers
    else if (message.startsWith('OTA_READY:')) {
      const parts = message.substring(10).split(':');
      const ip = parts[0] || this.wifi.ip;
      this.log(`🚀 ESP32 OTA Ready! Connecting to direct WebSocket ws://${ip}:81. Bluetooth shutting down...`, 'info');
      this.otaStatus = 'UPDATING';
      this.otaProgress = 5;
      this.otaMessage = 'Connecting to ESP32 local WebSocket for live flash progress...';
      if (ip && ip !== '0.0.0.0') {
        this.connectWifiLan(ip);
      }
    }
    else if (message.startsWith('OTA_PROGRESS:')) {
      const parts = message.substring(13).split(':');
      this.otaProgress = parseInt(parts[0], 10) || 0;
      this.otaStatus = 'UPDATING';
      this.otaMessage = parts.slice(1).join(':') || `Flashing ESP32: ${this.otaProgress}%`;
      this.log(`[OTA Flash] ${this.otaProgress}% - ${this.otaMessage}`, 'info');
    }
    else if (message.startsWith('OTA_COMPLETE')) {
      this.otaProgress = 100;
      this.otaStatus = 'SUCCESS';
      this.otaMessage = 'Firmware flashed successfully! ESP32 is rebooting...';
      this.log('✅ ESP32 Firmware OTA Flash Complete! Rebooting...', 'success');
      this.vibrate([100, 50, 100, 50, 200]);
    }
    else if (message.startsWith('OTA_ERROR:')) {
      this.otaStatus = 'ERROR';
      this.otaMessage = message.substring(10) || 'OTA Update Failed';
      this.log(`❌ OTA Update Failed: ${this.otaMessage}`, 'error');
    }
    else if (message.startsWith('FIRMWARE_VER:')) {
      this.currentFirmwareVer = message.substring(13).trim();
      this.hasFirmwareUpdate = this.latestFirmwareVer !== this.currentFirmwareVer;
      if (this.targetFlashingVersion && this.currentFirmwareVer === this.targetFlashingVersion) {
        this.otaStatus = 'SUCCESS';
        this.otaProgress = 100;
        this.otaMessage = `Updated to v${this.currentFirmwareVer} successfully!`;
        this.log(`🎉 OTA Flash Verified: ESP32 running v${this.currentFirmwareVer}!`, 'success');
        this.targetFlashingVersion = '';
      } else if (!this.hasFirmwareUpdate) {
        this.otaStatus = 'IDLE';
        this.otaMessage = `Firmware is up to date (v${this.currentFirmwareVer}).`;
      }
      this.log(`ESP32 Running Firmware: v${this.currentFirmwareVer}`, 'info');
    }
    else {
      this.log(`ESP32: ${message}`);
    }
  }
}
