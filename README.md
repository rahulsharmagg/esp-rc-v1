# ESP32 RC AI Cockpit (esp-rc-v1)

A high-performance, ultra-low latency **ESP32 RC Car & Robot Controller** featuring **Web Bluetooth Low Energy (Nordic UART Service)**, an installable **Progressive Web App (PWA)**, and an **Autonomous Obstacle Avoidance & Patrol AI Engine**.

---

## 📸 Overview & Features

- **🏎️ Multi-Mode Touch Interface:**
  - Dynamic Virtual Touch Joystick with proportional angle & vector mapping.
  - Multi-touch tactile D-Pad (zero latency `touchstart`/`pointerdown`).
  - Tank / Differential dual-motor sliders.
- **🤖 Autonomous Navigation (AI Driving):**
  - **Auto Obstacle Avoidance:** Real-time HC-SR04 scanning every 60ms with automatic emergency brake $\to$ reverse clearance $\to$ alternating pivot turns.
  - **Auto Patrol Mode:** Programmed autonomous figure-8 / room patrol patterns.
  - **Instant Human Override:** Any manual touch gesture immediately disengages autonomous mode.
- **🗺️ 150×150 Minimap & Radar HUD:**
  - Dedicated 150x150 minimap slot for sensor/robot visualization.
  - Real-time ultrasonic distance gauge with dynamic color warning zones.
- **📜 Live UART Ticker:**
  - Bottom-to-top linear opacity fading stream logs.
- **🎨 High-Contrast Light Mech Theme:**
  - Black & red cyber styling on a light checkered grid background.
  - Rectangular tech typography (**Chakra Petch** & **JetBrains Mono**).
  - Landscape-only viewport lock (`100dvh`).
- **📶 Web Bluetooth Low Energy (BLE):**
  - Standard Nordic UART GATT Service.
  - Automatic reconnection backoff & heartbeat watchdog failsafe.
- **📦 100% Offline PWA:**
  - Resilient `Promise.allSettled` cache-first service worker.

---

## ⚡ Hardware Pinout & Wiring Guide

```
+-------------------------------------------------------------+
|                        ESP32 DevKit                         |
|                                                             |
|   GPIO 18  -------------------------> IN1 / Motor Left PWM  |
|   GPIO 19  -------------------------> IN2 / Motor Left DIR  |
|   GPIO 22  -------------------------> IN3 / Motor Right PWM |
|   GPIO 23  -------------------------> IN4 / Motor Right DIR |
|                                                             |
|   GPIO 5   -------------------------> HC-SR04 TRIG          |
|   GPIO 17  <------------------------- HC-SR04 ECHO          |
|                                                             |
|   GPIO 13  -------------------------> Headlight LED (+)     |
|   GPIO 12  -------------------------> Horn / Buzzer (+)     |
|   GND      -------------------------> Common GND            |
|   VIN (5V) <------------------------- 5V BEC / Motor Driver |
+-------------------------------------------------------------+
```

---

## 📡 Web Bluetooth UART Protocol

- **Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **Rx Characteristic (Write):** `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- **Tx Characteristic (Notify):** `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

### Command Matrix

| Command | Action |
| :--- | :--- |
| `A` | Engage Autonomous Obstacle Avoidance |
| `a` | Disengage Auto / Return to Manual Control |
| `P` | Engage Auto Patrol Mode |
| `F`, `B`, `L`, `R` | Forward, Reverse, Spin Left, Spin Right |
| `G`, `I`, `H`, `J` | Diagonal / Arc Turns |
| `S` | Emergency Brake / Stop |
| `V<0-255>` | Set PWM Throttle Speed |
| `D:<left>,<right>` | Differential Tank Drive |
| `W` / `w` | Headlights ON / OFF |
| `U` / `u` | Horn ON / OFF |

---

## 🚀 Running the PWA Locally

Web Bluetooth requires **HTTPS** or **`localhost`**:

```bash
# Start local Node.js static server
node server.js
```
Open **[http://localhost:8080](http://localhost:8080)** in Google Chrome or Microsoft Edge.

---

## 🛠️ Flashing the ESP32 Firmware

1. Open `esp32_car.ino` in the **Arduino IDE**.
2. Select **ESP32 Dev Module** as your target board.
3. Choose your serial port and click **Upload**.
