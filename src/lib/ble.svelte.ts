import type { DriveMode, LogEntry, WifiNetwork, WifiStatus } from './types';

const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class BLEController {
  // Connection State
  isConnected = $state(false);
  isConnecting = $state(false);
  deviceName = $state('DISCONNECTED');
  latency = $state(0);

  // Telemetry
  uptime = $state('00:00');
  driveMode = $state<DriveMode>('MANUAL');
  batteryPct = $state(85);
  batteryVolts = $state(7.8);
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
        optionalServices: [NORDIC_UART_SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnected());

      this.log(`Connecting to GATT Server [${this.device.name || 'ESP32'}]...`);
      this.server = await this.device.gatt!.connect();

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

      // Sync initial speed and mode
      this.sendSpeed(this.currentSpeed);
      this.setDriveMode('MANUAL');
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
  }

  sendCommand(cmd: string, force = false) {
    if (!cmd) return;

    if (this.onMovementChange && !cmd.startsWith('E:') && !cmd.startsWith('V') && !cmd.startsWith('P:') && !cmd.startsWith('WIFI:')) {
      this.onMovementChange(cmd, this.currentSpeed);
    }

    if (!force && cmd === this.lastSentCommand && (Date.now() - this.lastSentTimestamp) < 120) {
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

  private async flushCommand() {
    if (!this.pendingCommand) return;
    const cmd = this.pendingCommand;
    this.pendingCommand = null;
    this.lastSentCommand = cmd;
    this.lastSentTimestamp = Date.now();

    if (!this.isConnected || !this.rxChar) return;

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
      this.log(`Transmit error: ${err.message}`, 'error');
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
    this.sendCommand(on ? 'V' : 'v', true);
    if (on) this.vibrate([20, 20]);
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

  connectToWifi(ssid: string, pass: string) {
    this.log(`Connecting ESP32 to Wi-Fi SSID [${ssid}]...`, 'info');
    this.sendCommand(`WIFI:CONN:${ssid}:${pass}`, true);
  }

  disconnectWifi() {
    this.sendCommand('WIFI:DISC', true);
    this.log('Disconnecting ESP32 from Wi-Fi AP...', 'warn');
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

    // 1. T:<uptime_sec>,<dist>,<ir_l>,<ir_r>,<servo>,<bat_pct>,<bat_v>,<mode>
    if (message.startsWith('T:')) {
      const parts = message.substring(2).split(',');
      if (parts.length >= 8) {
        const uptimeSec = parseInt(parts[0], 10) || 0;
        this.distance = parseInt(parts[1], 10) || 0;
        this.irLeft = parseInt(parts[2], 10) === 1;
        this.irRight = parseInt(parts[3], 10) === 1;
        this.servoAngle = parseInt(parts[4], 10) || 90;
        this.batteryPct = parseInt(parts[5], 10) || 0;
        this.batteryVolts = parseFloat(parts[6]) || 0;
        const mode = parts[7];

        const m = Math.floor(uptimeSec / 60);
        const s = uptimeSec % 60;
        this.uptime = `${m}:${s < 10 ? '0' : ''}${s}`;

        if (mode === 'A' && this.driveMode !== 'AUTOMATIC') this.driveMode = 'AUTOMATIC';
        else if (mode === 'M' && this.driveMode !== 'MANUAL') this.driveMode = 'MANUAL';
      }
    } 
    // 2. Wi-Fi Scan Result
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
      } else if (state === 'CONNECTED') {
        this.wifi = { enabled: true, connected: true, ssid, ip, rssi };
        this.log(`Wi-Fi Connected! IP: ${ip} (SSID: ${ssid})`, 'success');
      } else {
        this.wifi = { enabled: true, connected: false, ssid: '', ip: '0.0.0.0', rssi: 0 };
      }
    } else {
      this.log(`ESP32: ${message}`);
    }
  }
}
