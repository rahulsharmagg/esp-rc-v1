# ESP32 Robot Firmware Management & OTA System

A complete zero-dependency firmware distribution, version cataloging, and Over-The-Air (OTA) flashing system for the ESP32 obstacle-avoiding RC car.

---

## 1. System Architecture

```
+--------------------------------------------------------------------------+
|                            NODE.JS SERVER                                |
|  - Native Node.js standard library (http, fs, path, crypto, url)        |
|  - Zero external npm runtime dependencies                                |
|  - Persistent storage in firmware/ (outside disposable dist/)            |
+------------------------------------+-------------------------------------+
                                     |
             +-----------------------+-----------------------+
             |                                               |
             v                                               v
+-----------------------------+               +-----------------------------+
|        SVELTE 5 PWA         |               |       ESP32 ROBOT MCU       |
| - Automatic update alerts   |               | - Wi-Fi Station Mode        |
| - Rollback / Version picker |  BLE UART /   | - HTTPUpdate (Plain/Secure) |
| - Live flash progress bar   |  Command Bus  | - Non-blocking fallback     |
| - Offline Service Worker    | ------------> | - Permanent operation if    |
+-----------------------------+               |   firmware server is down   |
                                              +-----------------------------+
```

---

## 2. Directory Structure

Firmware binaries and release metadata are permanently retained under the top-level `firmware/` directory:

```text
firmware/
├── stable.json
└── esp32/
    ├── 1.0.0/
    │   ├── firmware.bin
    │   └── manifest.json
    ├── 1.0.1/
    │   ├── firmware.bin
    │   └── manifest.json
    └── 1.0.2/
        ├── firmware.bin
        └── manifest.json
```

> [!IMPORTANT]
> **Persistent Retention Policy:**
> - Firmware binaries are stored in `firmware/` and **never** in `dist/`.
> - Older versions are **never deleted automatically** and remain permanently available for rollbacks.
> - Releases are immutable: once published, re-releasing an existing version tag requires explicit confirmation.

---

## 3. Metadata Schemas

### `firmware/stable.json`
Tracks the current official stable release for production devices:
```json
{
  "version": "1.0.2",
  "device": "esp32-robot",
  "minAppVersion": "1.0.0",
  "mandatory": false,
  "notes": "Obstacle avoidance algorithm tuning, servo center calibration, and battery telemetry fix.",
  "releasedAt": "2026-09-30T15:00:00.000Z",
  "downloadUrl": "/firmware/esp32/1.0.2/firmware.bin",
  "sha256": "47a3e8f85f524d7732d8de28399589d6e87f37e415d86ef8f2c253b2184e932b",
  "size": 1718217
}
```

### `firmware/esp32/<version>/manifest.json`
Detailed metadata for each specific version:
```json
{
  "version": "1.0.2",
  "device": "esp32-robot",
  "notes": "Obstacle avoidance algorithm tuning, servo center calibration, and battery telemetry fix.",
  "releasedAt": "2026-09-30T15:00:00.000Z",
  "downloadUrl": "/firmware/esp32/1.0.2/firmware.bin",
  "sha256": "47a3e8f85f524d7732d8de28399589d6e87f37e415d86ef8f2c253b2184e932b",
  "size": 1718217,
  "checksumType": "sha256"
}
```

---

## 4. REST API Reference

The backend implements the following zero-dependency REST endpoints:

### `GET /api/firmware/latest`
Returns the metadata of the currently designated stable firmware release.

- **Query Parameters**:
  - `device` (optional): Filter by device target (default: `esp32-robot`).
- **Response Headers**: `Cache-Control: no-cache`
- **Response Example**:
```json
{
  "status": "success",
  "latest": {
    "version": "1.0.2",
    "device": "esp32-robot",
    "notes": "...",
    "downloadUrl": "/firmware/esp32/1.0.2/firmware.bin",
    "sha256": "47a3e8f85f524d7732d8de28399589d6e87f37e415d86ef8f2c253b2184e932b",
    "size": 1718217
  }
}
```

---

### `GET /api/firmware/versions`
Returns an array of all available historical versions sorted by semantic version in descending order (`1.0.10` > `1.0.9` > `1.0.0`).

- **Query Parameters**:
  - `device` (optional): Filter by target hardware.
- **Response Example**:
```json
{
  "status": "success",
  "count": 3,
  "stableVersion": "1.0.2",
  "versions": [
    {
      "version": "1.0.2",
      "device": "esp32-robot",
      "notes": "Obstacle avoidance tuning...",
      "releasedAt": "2026-09-30T15:00:00.000Z",
      "downloadUrl": "/firmware/esp32/1.0.2/firmware.bin",
      "sha256": "47a3e8f85f524d7732d8de28399589d6e87f37e415d86ef8f2c253b2184e932b",
      "size": 1718217,
      "isStable": true
    },
    {
      "version": "1.0.1",
      "device": "esp32-robot",
      "notes": "Added dual headlight LED and horn commands",
      "releasedAt": "2026-09-20T10:00:00.000Z",
      "downloadUrl": "/firmware/esp32/1.0.1/firmware.bin",
      "sha256": "5c9b91ff90928923a1a1f0a202419c8f000b21a00a12e4d0cb5a911e38a2bc40",
      "size": 1698200,
      "isStable": false
    },
    {
      "version": "1.0.0",
      "device": "esp32-robot",
      "notes": "Initial factory release",
      "releasedAt": "2026-09-01T00:00:00.000Z",
      "downloadUrl": "/firmware/esp32/1.0.0/firmware.bin",
      "sha256": "3a088bc8a9b9a6745ec82e4e899b1a59ec1e899a16f6b553e1a690e54dca1918",
      "size": 1650000,
      "isStable": false
    }
  ]
}
```

---

### `GET /api/firmware/:version`
Returns metadata and manifest details for a specific version.

- **Path Parameters**:
  - `version`: Strict SemVer string (e.g. `1.0.1`).
- **Security**: Rejects path traversal patterns (`..`, `/`, `\`) with `400 Bad Request`.

---

### `GET /firmware/esp32/:version/firmware.bin`
Streams the binary firmware image to the ESP32 or client.

- **Content-Type**: `application/octet-stream`
- **Headers**:
  - `Content-Length`: Accurate binary size in bytes.
  - `Cache-Control`: `public, max-age=31536000, immutable` (since release versions are immutable).

---

## 5. Publishing a New Firmware Release

Use the included zero-dependency CLI tool [`scripts/release-firmware.js`](file:///g:/esp-rc-v1/scripts/release-firmware.js):

### Command Syntax
```bash
node scripts/release-firmware.js <version> <path-to-firmware.bin> [options]
```

### Options
- `--stable`: Mark this release as the current stable version in `firmware/stable.json`.
- `--notes "<description>"`: Add release changelog / notes.
- `--device "<name>"`: Target hardware profile (default: `esp32-robot`).
- `--min-app "<version>"`: Minimum supported web app version (default: `1.0.0`).
- `--mandatory`: Flag this update as mandatory.

### Examples
```bash
# Publish version 1.0.3 and mark as stable
node scripts/release-firmware.js 1.0.3 build/esp-rc-v1.ino.bin --stable --notes "Optimized ADC battery sampling and smoothed motor acceleration"

# Publish experimental beta release without modifying stable.json
node scripts/release-firmware.js 1.1.0-beta.1 build/esp-rc-v1.ino.bin --notes "Experimental Wi-Fi camera streaming support"
```

The script will:
1. Validate SemVer format.
2. Calculate SHA-256 hash using Node.js `crypto`.
3. Create `firmware/esp32/<version>/`.
4. Copy `firmware.bin` and generate `manifest.json`.
5. Update `firmware/stable.json` if `--stable` is provided.

---

## 6. ESP32 OTA Flashing & Resilience

### Flash Execution Flow
1. **Trigger**: User clicks **UPDATE TO vX.Y.Z** or **FLASH vX.Y.Z** in the Svelte Cockpit Settings modal.
2. **BLE Command**: App sends `OTA:UPDATE:http://<server-ip>:8080/firmware/esp32/<version>/firmware.bin` over Nordic UART.
3. **Safety Stop**: ESP32 immediately stops all motors and centers the servo.
4. **Download & Stream**: ESP32 connects to the download URL via `HTTPUpdate` (`WiFiClient` or `WiFiClientSecure`).
5. **Real-time Progress**: ESP32 sends `OTA_PROGRESS:<percent>:<status>` via BLE telemetry to update the PWA progress bar.
6. **Integrity & Commit**: Flash partition verified, `OTA_COMPLETE` notification dispatched, and ESP32 restarts into the new firmware.

### Server Offline Resilience
If the firmware server or Wi-Fi network is unavailable:
- The ESP32 logs an error over Serial and reports `OTA_ERROR:<reason>` to the PWA.
- The robot safely reverts to manual mode without blocking the loop or corrupting the existing boot partition.
- Motor drives and BLE controls remain 100% operational.

---

## 7. Version Rollback & Downgrades

To downgrade to an earlier release:
1. Open the **Cockpit Settings** modal.
2. In the **Firmware Management** section, locate the **SELECT TARGET VERSION / ROLLBACK** dropdown.
3. Choose any previously published version (e.g. `1.0.1` or `1.0.0`).
4. Click **FLASH v<version>**.
5. The ESP32 downloads the requested binary and flashes it immediately.
