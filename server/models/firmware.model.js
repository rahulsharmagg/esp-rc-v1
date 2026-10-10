const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FIRMWARE_ROOT } = require('../config/index.js');
const { compareSemver, SEMVER_REGEX } = require('../utils/semver.js');

class FirmwareModel {
  static getRoot() {
    return FIRMWARE_ROOT;
  }

  static getEspDir() {
    return path.join(FIRMWARE_ROOT, 'esp32');
  }

  static getVersionDir(version) {
    return path.join(FIRMWARE_ROOT, 'esp32', version);
  }

  static getStableFilePath() {
    return path.join(FIRMWARE_ROOT, 'stable.json');
  }

  static getBinaryPath(version) {
    return path.join(this.getVersionDir(version), 'firmware.bin');
  }

  static getManifestPath(version) {
    return path.join(this.getVersionDir(version), 'manifest.json');
  }

  static getLatestStable(device = 'esp32-robot') {
    const stableFile = this.getStableFilePath();
    if (!fs.existsSync(stableFile)) {
      return { device, version: null, available: false };
    }
    try {
      return JSON.parse(fs.readFileSync(stableFile, 'utf8'));
    } catch {
      return { device, version: null, available: false };
    }
  }

  static getAllVersions(device = 'esp32-robot') {
    const espDir = this.getEspDir();
    if (!fs.existsSync(espDir)) {
      return { device, versions: [] };
    }

    try {
      const entries = fs.readdirSync(espDir, { withFileTypes: true });
      const versions = [];

      for (const entry of entries) {
        if (entry.isDirectory() && SEMVER_REGEX.test(entry.name)) {
          const manifestPath = path.join(espDir, entry.name, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              versions.push({
                version: manifest.version || entry.name,
                channel: manifest.channel || 'stable',
                size: manifest.size || 0,
                sha256: manifest.sha256 || '',
                description: manifest.description || '',
                releasedAt: manifest.releasedAt || new Date().toISOString()
              });
            } catch {}
          }
        }
      }

      versions.sort((a, b) => compareSemver(b.version, a.version));
      return { device, versions };
    } catch {
      return { device, versions: [] };
    }
  }

  static getVersionManifest(version) {
    const manifestPath = this.getManifestPath(version);
    if (!fs.existsSync(manifestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  }

  static saveRelease({ device = 'esp32-robot', version, channel = 'stable', description = '', isStable = false, binBuffer }) {
    const versionDir = this.getVersionDir(version);
    fs.mkdirSync(versionDir, { recursive: true });

    const binPath = this.getBinaryPath(version);
    fs.writeFileSync(binPath, binBuffer);

    const sha256 = crypto.createHash('sha256').update(binBuffer).digest('hex');
    const size = binBuffer.length;
    const releasedAt = new Date().toISOString();

    const manifest = {
      device,
      version,
      channel,
      firmware: 'firmware.bin',
      size,
      sha256,
      description: description.trim(),
      releasedAt
    };

    const manifestPath = this.getManifestPath(version);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    if (isStable) {
      const stablePayload = {
        device,
        channel: 'stable',
        version,
        firmware: `/firmware/esp32/${version}/firmware.bin`,
        sha256,
        size,
        description: description.trim(),
        releasedAt
      };
      const stablePath = this.getStableFilePath();
      fs.writeFileSync(stablePath, JSON.stringify(stablePayload, null, 2) + '\n', 'utf8');
    }

    return { manifest, size, sha256, isStable };
  }
}

module.exports = {
  FirmwareModel
};
