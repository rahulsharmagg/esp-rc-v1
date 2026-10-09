import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sendJson, sendError } from '../utils/response.js';
import { parseSemver, compareSemver, SEMVER_REGEX } from '../utils/semver.js';
import { parseMultipart } from '../utils/multipart.js';

const SUPPORTED_DEVICES = ['esp32-robot'];

export function createFirmwareHandler({ firmwareRoot, adminPassword }) {
  const FIRMWARE_ROOT = firmwareRoot;
  const ADMIN_PASSWORD = adminPassword || 'rcadmin';

  /**
   * Handle Direct Binary Upload
   */
  function handleUpload(req, res) {
    const contentType = req.headers['content-type'] || '';
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const totalBuffer = Buffer.concat(chunks);
        let password = '';
        let version = '';
        let channel = 'stable';
        let isStable = false;
        let device = 'esp32-robot';
        let description = '';
        let binBuffer = null;

        if (contentType.includes('multipart/form-data')) {
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
          password = req.headers['x-admin-password'] || '';
          version = req.headers['x-firmware-version'] || req.headers['x-version'] || '';
          channel = req.headers['x-firmware-channel'] || req.headers['x-channel'] || 'stable';
          description = decodeURIComponent(req.headers['x-firmware-description'] || req.headers['x-description'] || '');
          isStable = req.headers['x-set-stable'] === 'true' || req.headers['x-stable'] === 'true';
          device = req.headers['x-device'] || 'esp32-robot';
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

        const versionDir = path.join(FIRMWARE_ROOT, 'esp32', version);
        fs.mkdirSync(versionDir, { recursive: true });

        const binPath = path.join(versionDir, 'firmware.bin');
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

        const manifestPath = path.join(versionDir, 'manifest.json');
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
          const stablePath = path.join(FIRMWARE_ROOT, 'stable.json');
          fs.writeFileSync(stablePath, JSON.stringify(stablePayload, null, 2) + '\n', 'utf8');
        }

        console.log(`\n📦 [Firmware Upload] Successfully published v${version} (${(size / 1024).toFixed(1)} KB)${isStable ? ' [STABLE]' : ''}`);

        sendJson(res, 200, {
          success: true,
          message: `Firmware v${version} uploaded and published successfully!`,
          manifest,
          isStable
        });
      } catch (err) {
        console.error('[Upload Error]', err);
        sendError(res, 500, `Upload failed: ${err.message}`);
      }
    });
  }

  /**
   * Handle Binary Stream to ESP32
   */
  function handleBinaryStream(req, res, reqPath) {
    const binaryMatch = reqPath.match(/^\/firmware\/esp32\/([^\/]+)\/firmware\.bin$/);
    if (!binaryMatch) return false;

    const version = binaryMatch[1];
    if (!SEMVER_REGEX.test(version) || version.includes('..')) {
      sendError(res, 400, 'Invalid firmware version');
      return true;
    }

    const binaryPath = path.join(FIRMWARE_ROOT, 'esp32', version, 'firmware.bin');

    if (!fs.existsSync(binaryPath)) {
      sendError(res, 404, 'Firmware binary not found');
      return true;
    }

    fs.stat(binaryPath, (err, stats) => {
      if (err || !stats.isFile()) {
        sendError(res, 404, 'Firmware binary not found');
        return;
      }

      const totalSize = stats.size;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': totalSize,
        'Content-Disposition': `attachment; filename="firmware-${version}.bin"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(binaryPath);
      stream.pipe(res);
    });

    return true;
  }

  /**
   * Main Router for Firmware Endpoints
   */
  return function handleFirmwareRoutes(req, res, reqPath, urlObj) {
    const device = urlObj.searchParams.get('device') || 'esp32-robot';

    // 0. POST /api/firmware/upload
    if (reqPath === '/api/firmware/upload' && req.method === 'POST') {
      handleUpload(req, res);
      return true;
    }

    // 1. GET /api/firmware/latest
    if (reqPath === '/api/firmware/latest') {
      const stableFile = path.join(FIRMWARE_ROOT, 'stable.json');
      if (!fs.existsSync(stableFile)) {
        sendJson(res, 200, { device, version: null, available: false }, {
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
        });
        return true;
      }

      try {
        const content = JSON.parse(fs.readFileSync(stableFile, 'utf8'));
        sendJson(res, 200, content, {
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
        });
      } catch (err) {
        sendError(res, 500, 'Firmware service unavailable');
      }
      return true;
    }

    // 2. GET /api/firmware/versions
    if (reqPath === '/api/firmware/versions') {
      const espDir = path.join(FIRMWARE_ROOT, 'esp32');
      if (!fs.existsSync(espDir)) {
        sendJson(res, 200, { device, versions: [] }, { 'Cache-Control': 'no-cache, max-age=0' });
        return true;
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

        sendJson(res, 200, { device, versions }, {
          'Cache-Control': 'no-cache, max-age=0'
        });
      } catch (err) {
        sendError(res, 500, 'Firmware service unavailable');
      }
      return true;
    }

    // 3. GET /api/firmware/:version/manifest
    const manifestMatch = reqPath.match(/^\/api\/firmware\/([^\/]+)\/manifest$/);
    if (manifestMatch) {
      const version = manifestMatch[1];
      const manifestPath = path.join(FIRMWARE_ROOT, 'esp32', version, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        sendError(res, 404, 'Manifest not found for version');
        return true;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        sendJson(res, 200, manifest, { 'Cache-Control': 'public, max-age=31536000, immutable' });
      } catch (err) {
        sendError(res, 500, 'Firmware service unavailable');
      }
      return true;
    }

    // 4. GET /api/firmware/:version
    const versionMatch = reqPath.match(/^\/api\/firmware\/([^\/]+)$/);
    if (versionMatch) {
      const version = versionMatch[1];
      const manifestPath = path.join(FIRMWARE_ROOT, 'esp32', version, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        sendError(res, 404, 'Firmware version not found');
        return true;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        sendJson(res, 200, {
          device: manifest.device || device,
          version: manifest.version || version,
          channel: manifest.channel || 'stable',
          firmware: `/firmware/esp32/${version}/firmware.bin`,
          sha256: manifest.sha256 || '',
          size: manifest.size || 0,
          description: manifest.description || '',
          releasedAt: manifest.releasedAt || new Date().toISOString()
        }, { 'Cache-Control': 'public, max-age=31536000, immutable' });
      } catch (err) {
        sendError(res, 500, 'Firmware service unavailable');
      }
      return true;
    }

    // 5. Binary file streaming
    if (reqPath.startsWith('/firmware/')) {
      return handleBinaryStream(req, res, reqPath);
    }

    return false;
  };
}
