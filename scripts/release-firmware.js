import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const FIRMWARE_ROOT = path.join(ROOT_DIR, 'firmware');

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function printUsage() {
  console.log(`
===================================================================
 ESP32 Robot Firmware Release Manager
===================================================================
Usage:
  node scripts/release-firmware.js <version> <path/to/firmware.bin> [options]

Options:
  --stable              Mark this version as the current stable release in stable.json
  --device <device>     Target device ID (default: esp32-robot)
  --channel <channel>   Release channel (default: stable)

Examples:
  node scripts/release-firmware.js 1.0.3 build/firmware.bin
  node scripts/release-firmware.js 1.0.3 build/firmware.bin --stable
  node scripts/release-firmware.js 1.1.0-beta.1 firmware.bin --channel beta
===================================================================
`);
}

export function computeFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

export function releaseFirmware(version, sourceBinPath, options = {}) {
  const device = options.device || 'esp32-robot';
  const channel = options.channel || 'stable';
  const isStable = !!options.isStable;

  if (!version || !SEMVER_REGEX.test(version)) {
    throw new Error(`Invalid semantic version "${version}". Version must follow semver (e.g., 1.0.0, 1.0.10, 1.1.0-beta.1).`);
  }

  if (!sourceBinPath || !fs.existsSync(sourceBinPath)) {
    throw new Error(`Source firmware binary file not found at: ${sourceBinPath}`);
  }

  const stat = fs.statSync(sourceBinPath);
  if (!stat.isFile()) {
    throw new Error(`Source path is not a file: ${sourceBinPath}`);
  }

  const versionDir = path.join(FIRMWARE_ROOT, device.startsWith('esp32') ? 'esp32' : device, version);
  const isForce = !!options.force;

  if (fs.existsSync(versionDir) && !isForce) {
    throw new Error(`Firmware version directory already exists: ${versionDir}\nUse --force to overwrite an existing version.`);
  }

  // Create directory structure
  fs.mkdirSync(versionDir, { recursive: true });

  // Copy binary
  const destBinPath = path.join(versionDir, 'firmware.bin');
  fs.copyFileSync(sourceBinPath, destBinPath);

  // Calculate SHA-256 & size
  const sha256 = computeFileSha256(destBinPath);
  const size = fs.statSync(destBinPath).size;
  const releasedAt = new Date().toISOString();

  // Create manifest.json
  const manifest = {
    device,
    version,
    channel,
    firmware: 'firmware.bin',
    size,
    sha256,
    releasedAt
  };

  const manifestPath = path.join(versionDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`\n✅ Firmware ${version} packaged successfully!`);
  console.log(`   📂 Path:     ${versionDir}`);
  console.log(`   📦 Size:     ${size.toLocaleString()} bytes`);
  console.log(`   🔒 SHA-256:  ${sha256}`);
  console.log(`   📄 Manifest: ${manifestPath}`);

  // Update stable.json if requested
  if (isStable) {
    const stablePayload = {
      device,
      channel: 'stable',
      version,
      firmware: `/firmware/esp32/${version}/firmware.bin`,
      sha256,
      size,
      releasedAt
    };

    const stablePath = path.join(FIRMWARE_ROOT, 'stable.json');
    fs.writeFileSync(stablePath, JSON.stringify(stablePayload, null, 2) + '\n', 'utf8');
    console.log(`\n🌟 Updated stable.json to point to version ${version}`);
  }

  return manifest;
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const version = args[0];
  const binPath = path.resolve(args[1]);

  let isStable = false;
  let force = false;
  let device = 'esp32-robot';
  let channel = 'stable';

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--stable') {
      isStable = true;
    } else if (args[i] === '--force' || args[i] === '-f') {
      force = true;
    } else if (args[i] === '--device' && args[i + 1]) {
      device = args[++i];
    } else if (args[i] === '--channel' && args[i + 1]) {
      channel = args[++i];
    }
  }

  try {
    releaseFirmware(version, binPath, { isStable, force, device, channel });
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Release Error: ${err.message}\n`);
    process.exit(1);
  }
}
