# ESP-RC: Web Bluetooth & Wi-Fi Robotic Cockpit

A high-performance, low-latency progressive web application (PWA) designed for real-time control, sensor telemetry visualization, and autonomous navigation of ESP32-based robotic vehicles.

---

## Overview

ESP-RC provides a responsive cockpit interface built with Svelte 5 and TypeScript. It interfaces with the ESP32 microcontroller using standard Nordic Semiconductor UART Service (NUS) over Web Bluetooth Low Energy (BLE) and optional 2.4GHz Wi-Fi telemetry.

### Core Features

- **Multi-Mode Control Surface**:
  - Virtual 360-degree analog joystick with dynamic vector and angle calculation.
  - Tactical 8-way directional pad with diagonal steering and center emergency brake.
  - Dual-track mechanical differential sliders for tank drive configurations.
  - Vertical throttle quadrant with preset steps (25%, 50%, 75%, 100%) and temporary turbo boost.
- **Autonomous Obstacle Avoidance**:
  - Closed-loop obstacle avoidance using SG90 ultrasonic servo scanning and dual infrared proximity sensors.
  - Automatic emergency stop, reverse clearance maneuvers, and alternate path selection.
  - Seamless manual touch override that disengages autonomous modes immediately.
- **Tactical 150x150 Radar HUD & Minimap**:
  - Dead-reckoning matrix canvas with real-time motion and heading dynamics.
  - Active ultrasonic radar sweep cone tracking SG90 servo angles.
  - Proximity warning indicators for left and right IR sensor states.
  - Tactical green and black radar aesthetic with dynamic obstacle blip rendering.
- **Peripherals & Power Management**:
  - Digital headlight toggling and instantaneous horn buzzer control.
  - Individual hardware sensor enable/disable registry (Ultrasonic, SG90 Servo, Left IR, Right IR).
  - ESP32 2.4GHz Wi-Fi radio scanner with signal strength indicators and connection manager.
  - Real-time battery telemetry, uptime counters, and round-trip BLE latency tracking.
- **Progressive Web App (PWA)**:
  - Offline caching with automatic service worker lifecycle management.
  - Native fullscreen landscape orientation when installed on mobile devices.
  - Long-press touch callout and context menu suppression for mobile browsers.

---

## Architecture & Technology Stack

- **Frontend Framework**: Svelte 5 (Runes architecture: `$state`, `$derived`, `$props`)
- **Language**: TypeScript
- **Bundler & Build Tool**: Vite 5 + `@sveltejs/vite-plugin-svelte`
- **PWA Integration**: `vite-plugin-pwa` + Workbox
- **Icons**: `@lucide/svelte`
- **Firmware**: Arduino C++ (ESP32 Arduino Core 3.x compatible)
- **Communications**: Web Bluetooth GATT (Nordic UART Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`)

---

## Hardware Pinout & Wiring Specifications

```text
+-----------------------------------------------------------------+
|                       ESP32 DevKit V1                           |
|                                                                 |
|   GPIO 18  -------------------------> ENA / Motor Left PWM      |
|   GPIO 19  -------------------------> IN1 / Motor Left DIR 1    |
|   GPIO 21  -------------------------> IN2 / Motor Left DIR 2    |
|   GPIO 22  -------------------------> ENB / Motor Right PWM     |
|   GPIO 23  -------------------------> IN3 / Motor Right DIR 1   |
|   GPIO 25  -------------------------> IN4 / Motor Right DIR 2   |
|                                                                 |
|   GPIO 5   -------------------------> HC-SR04 TRIG              |
|   GPIO 17  <------------------------- HC-SR04 ECHO              |
|   GPIO 4   -------------------------> SG90 Servo Signal (PWM)   |
|                                                                 |
|   GPIO 34  <------------------------- Left IR Obstacle Sensor   |
|   GPIO 35  <------------------------- Right IR Obstacle Sensor  |
|                                                                 |
|   GPIO 13  -------------------------> Headlight LED Control     |
|   GPIO 12  -------------------------> Horn / Buzzer (+)         |
|   GPIO 36  <------------------------- Battery ADC Voltage Sense |
|                                                                 |
|   GND      -------------------------> Common Ground             |
|   VIN (5V) <------------------------- 5V BEC / Motor Regulator  |
+-----------------------------------------------------------------+
```

---

## Communication Protocol

### BLE Nordic UART Service UUIDs

- **Service UUID**: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **Rx Characteristic (Client Write)**: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- **Tx Characteristic (Server Notify)**: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

### Command Matrix (Web to ESP32)

| Command String | Description |
| :--- | :--- |
| `F` | Forward |
| `B` | Backward |
| `L` | Spin Left |
| `R` | Spin Right |
| `G` | Diagonal Forward Left |
| `I` | Diagonal Forward Right |
| `H` | Diagonal Reverse Left |
| `J` | Diagonal Reverse Right |
| `S` | Emergency Stop / Brake |
| `V<0-255>` | Set PWM Throttle Speed (e.g. `V200`) |
| `D:<left>,<right>` | Differential Tank Drive (e.g. `D:200,-150`) |
| `X` | Engage Autonomous Obstacle Avoidance Mode |
| `M` | Return to Manual Drive Mode |
| `W` / `w` | Headlights ON / OFF |
| `V` / `v` | Horn Sound ON / OFF |
| `E:<sensor>:<0\|1>` | Enable/Disable Sensor (`US`, `SRV`, `IRL`, `IRR`) |
| `P:<angle>` | Set Servo Angle (`0` to `180` degrees) |
| `WIFI:ON` / `WIFI:OFF` | Toggle ESP32 Wi-Fi Radio Power |
| `WIFI:SCAN` | Trigger 2.4GHz Wi-Fi Access Point Scan |
| `WIFI:CONN:<ssid>:<pass>` | Connect ESP32 Station Interface to Access Point |
| `WIFI:DISC` | Disconnect Wi-Fi Interface |

### Telemetry Packet (ESP32 to Web)

The ESP32 notifies the web application every 100ms with a comma-separated telemetry payload:

```text
T:<uptime_sec>,<distance_cm>,<ir_left>,<ir_right>,<servo_angle>,<battery_pct>,<battery_volts>,<mode>
```

- `uptime_sec`: ESP32 system uptime in seconds.
- `distance_cm`: Front obstacle distance measured by HC-SR04 ultrasonic sensor.
- `ir_left` / `ir_right`: Binary state (`1` = obstacle detected, `0` = clear).
- `servo_angle`: Current SG90 servo position (`0` to `180` degrees).
- `battery_pct`: Calculated battery charge percentage (`0` to `100`).
- `battery_volts`: Measured battery pack voltage.
- `mode`: Operating mode flag (`A` for Autonomous, `M` for Manual).

---

## Development & Local Setup

### Prerequisites

- Node.js 18+ and npm
- Google Chrome, Microsoft Edge, or a browser with Web Bluetooth API enabled
- Arduino IDE 2.x with the ESP32 board package installed

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/rahulsharmagg/esp-rc-v1.git
   cd esp-rc-v1
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Vite development server:
   ```bash
   npm run dev
   ```

4. Open the local address displayed in the terminal in a supported browser.

### Type Verification

To run TypeScript and Svelte diagnostics:

```bash
npm run check
```

### Production Build & Static Serving

```bash
# Generate production PWA bundle in dist/
npm run build

# Preview production build locally
npm run preview
```

---

## Flashing the ESP32 Firmware

1. Open `esp-rc-v1.ino` in the Arduino IDE.
2. Under **Tools > Board**, select **ESP32 Dev Module** (or your specific ESP32 variant).
3. Under **Tools > Upload Speed**, select `921600` or `115200`.
4. Connect the ESP32 board via USB, choose the corresponding COM / Serial port, and click **Upload**.
5. Once flashing completes, open the Serial Monitor at `115200` baud to observe initial hardware diagnostics and BLE advertising status.

---

## License

This project is licensed under the MIT License.
