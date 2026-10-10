const fs = require('fs');
const { FirmwareModel } = require('../models/firmware.model.js');
const { sendJson, sendError } = require('../utils/response.js');
const { SEMVER_REGEX } = require('../utils/semver.js');
const { parseMultipart } = require('../utils/multipart.js');
const { ADMIN_PASSWORD, MAX_UPLOAD_BYTES } = require('../config/index.js');

class FirmwareController {
  /**
   * Handle Binary Upload (JSON Base64 / Multipart / Raw)
   */
  static handleUpload(req, res, urlObj) {
    const contentType = req.headers['content-type'] || '';
    const chunks = [];
    let receivedBytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_UPLOAD_BYTES) {
        aborted = true;
        req.destroy();
        sendError(res, 413, 'Payload Too Large: Maximum allowed upload size is 10 MB');
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const totalBuffer = Buffer.concat(chunks);
        let password = '';
        let version = '';
        let channel = 'stable';
        let isStable = false;
        let device = 'esp32-robot';
        let description = '';
        let binBuffer = null;

        if (contentType.includes('application/json')) {
          const jsonBody = JSON.parse(totalBuffer.toString('utf8'));
          password = jsonBody.password || jsonBody.token || req.headers['x-admin-password'] || '';
          version = jsonBody.version || '';
          channel = jsonBody.channel || 'stable';
          description = jsonBody.description || jsonBody.changelog || '';
          isStable = jsonBody.isStable === true || jsonBody.isStable === 'true' || jsonBody.stable === true;
          device = jsonBody.device || 'esp32-robot';

          const b64Data = jsonBody.data || jsonBody.binary || jsonBody.file || jsonBody.firmware || '';
          if (b64Data) {
            const cleanBase64 = b64Data.replace(/^data:[^;]+;base64,/, '');
            binBuffer = Buffer.from(cleanBase64, 'base64');
          }
        } else if (contentType.includes('multipart/form-data')) {
          const boundaryMatch = contentType.match(/boundary=(?:["']?)([^"';]+)(?:["']?)/);
          if (!boundaryMatch) {
            sendError(res, 400, 'Invalid multipart boundary');
            return;
          }
          const boundary = boundaryMatch[1];
          const parsed = parseMultipart(totalBuffer, boundary);
          
          password = parsed.fields.password || req.headers['x-admin-password'] || '';
          version = parsed.fields.version || '';
          channel = parsed.fields.channel || 'stable';
          description = parsed.fields.description || parsed.fields.changelog || '';
          isStable = parsed.fields.isStable === 'true' || parsed.fields.isStable === '1' || parsed.fields.stable === 'true';
          device = parsed.fields.device || 'esp32-robot';

          const fileEntry = parsed.files.firmware || parsed.files.file || Object.values(parsed.files)[0];
          if (fileEntry) {
            binBuffer = fileEntry.data;
          }
        } else {
          password = (urlObj && urlObj.searchParams.get('password')) || req.headers['x-admin-password'] || '';
          version = (urlObj && urlObj.searchParams.get('version')) || req.headers['x-firmware-version'] || req.headers['x-version'] || '';
          channel = (urlObj && urlObj.searchParams.get('channel')) || req.headers['x-firmware-channel'] || req.headers['x-channel'] || 'stable';
          description = (urlObj && decodeURIComponent(urlObj.searchParams.get('description') || '')) || decodeURIComponent(req.headers['x-firmware-description'] || req.headers['x-description'] || '');
          isStable = (urlObj && urlObj.searchParams.get('isStable') === 'true') || req.headers['x-set-stable'] === 'true' || req.headers['x-stable'] === 'true';
          device = (urlObj && urlObj.searchParams.get('device')) || req.headers['x-device'] || 'esp32-robot';
          binBuffer = totalBuffer;
        }

        if (!password || password !== ADMIN_PASSWORD) {
          sendError(res, 401, 'Unauthorized: Invalid Admin Secret Password');
          return;
        }

        if (!version || !SEMVER_REGEX.test(version.trim())) {
          sendError(res, 400, `Invalid semantic version "${version}". Example: 1.0.7`);
          return;
        }
        version = version.trim();

        if (!binBuffer || binBuffer.length < 1000) {
          sendError(res, 400, 'Invalid or empty firmware binary file.');
          return;
        }

        const result = FirmwareModel.saveRelease({
          device,
          version,
          channel,
          description,
          isStable,
          binBuffer
        });

        console.log(`\n📦 [Firmware Upload] Published v${version} (${(result.size / 1024).toFixed(1)} KB)${result.isStable ? ' [STABLE]' : ''}`);

        sendJson(res, 200, {
          success: true,
          message: `Firmware v${version} uploaded and published successfully!`,
          manifest: result.manifest,
          isStable: result.isStable
        });
      } catch (err) {
        console.error('[Upload Error]', err);
        sendError(res, 500, `Upload failed: ${err.message}`);
      }
    });
  }

  /**
   * Get Latest Stable Firmware Metadata
   */
  static getLatest(req, res, urlObj) {
    const device = urlObj.searchParams.get('device') || 'esp32-robot';
    const latest = FirmwareModel.getLatestStable(device);
    sendJson(res, 200, latest, {
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
    });
  }

  /**
   * Get All Available Versions
   */
  static getVersions(req, res, urlObj) {
    const device = urlObj.searchParams.get('device') || 'esp32-robot';
    const data = FirmwareModel.getAllVersions(device);
    sendJson(res, 200, data, {
      'Cache-Control': 'no-cache, max-age=0'
    });
  }

  /**
   * Get Manifest of Specific Version
   */
  static getManifest(req, res, version) {
    const manifest = FirmwareModel.getVersionManifest(version);
    if (!manifest) {
      sendError(res, 404, `Manifest not found for version ${version}`);
      return;
    }
    sendJson(res, 200, manifest, {
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
  }

  /**
   * Get Version Info
   */
  static getVersionInfo(req, res, version, urlObj) {
    const device = (urlObj && urlObj.searchParams.get('device')) || 'esp32-robot';
    const manifest = FirmwareModel.getVersionManifest(version);
    if (!manifest) {
      sendError(res, 404, `Firmware version ${version} not found`);
      return;
    }
    sendJson(res, 200, {
      device: manifest.device || device,
      version: manifest.version || version,
      channel: manifest.channel || 'stable',
      firmware: `/firmware/esp32/${version}/firmware.bin`,
      sha256: manifest.sha256 || '',
      size: manifest.size || 0,
      description: manifest.description || '',
      releasedAt: manifest.releasedAt || new Date().toISOString()
    }, {
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
  }

  /**
   * Stream Raw Binary to ESP32
   */
  static streamBinary(req, res, version) {
    if (!SEMVER_REGEX.test(version) || version.includes('..')) {
      sendError(res, 400, 'Invalid firmware version');
      return true;
    }

    const binaryPath = FirmwareModel.getBinaryPath(version);
    if (!fs.existsSync(binaryPath)) {
      sendError(res, 404, 'Firmware binary not found');
      return true;
    }

    fs.stat(binaryPath, (err, stats) => {
      if (err || !stats.isFile()) {
        sendError(res, 404, 'Firmware binary not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size,
        'Content-Disposition': `attachment; filename="firmware-${version}.bin"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(binaryPath);
      stream.pipe(res);
    });

    return true;
  }
}

module.exports = {
  FirmwareController
};
