export interface TelemetryData {
  distance: number;
  irLeft: boolean;
  irRight: boolean;
  servoAngle: number;
  batteryPct: number;
  batteryVolts: number;
  uptime: string;
  driveMode: 'MANUAL' | 'AUTOMATIC';
  latency: number;
}

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  isEncrypted: boolean;
}

export interface WifiStatus {
  enabled: boolean;
  connected: boolean;
  ssid: string;
  ip: string;
  rssi: number;
}

export type DriveMode = 'MANUAL' | 'AUTOMATIC';
export type ControlMode = 'joystick' | 'dpad' | 'differential';

export interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export interface SensorStatus {
  id: string;
  name: string;
  pin: string;
  type: string;
  status: 'ONLINE' | 'ACTIVE' | 'NORMAL' | 'DETECTED' | 'CLEAR' | 'OFFLINE' | 'WARNING';
  value: string;
  details: string;
}

export interface FirmwareVersionInfo {
  version: string;
  channel: string;
  size: number;
  sha256: string;
  releasedAt: string;
}

export interface FirmwareLatestResponse {
  device: string;
  channel: string;
  version: string;
  firmware: string;
  sha256: string;
  size: number;
  releasedAt: string;
}

export interface FirmwareVersionsResponse {
  device: string;
  versions: FirmwareVersionInfo[];
}

