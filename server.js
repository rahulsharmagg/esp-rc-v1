import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'dist')) 
  ? path.join(__dirname, 'dist') 
  : __dirname;

const FIRMWARE_ROOT = path.join(__dirname, 'firmware');
const SUPPORTED_DEVICES = ['esp32-robot'];

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream'
};

/**
 * Pure Node.js Semantic Versioning Parser & Comparator (Zero Dependencies)
 */
function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const match = v.trim().match(SEMVER_REGEX);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split('.') : null
  };
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (!pa.prerelease && !pb.prerelease) return 0;

  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const segA = pa.prerelease[i];
    const segB = pb.prerelease[i];
    if (segA === undefined) return -1;
    if (segB === undefined) return 1;
    const numA = /^\d+$/.test(segA) ? parseInt(segA, 10) : null;
    const numB = /^\d+$/.test(segB) ? parseInt(segB, 10) : null;
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
    } else if (numA !== null && numB === null) {
      return -1;
    } else if (numA === null && numB !== null) {
      return 1;
    } else {
      const cmp = segA.localeCompare(segB);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

/**
 * Firmware Management Router
 */
function handleFirmwareApi(req, res, reqPath, urlObj) {
  const device = urlObj.searchParams.get('device') || 'esp32-robot';

  if (!SUPPORTED_DEVICES.includes(device)) {
    sendError(res, 400, 'Unsupported device type');
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
      console.error('[Firmware API] Error reading stable.json:', err.message);
      sendError(res, 500, 'Firmware service unavailable');
    }
    return true;
  }

  // 2. GET /api/firmware/versions
  if (reqPath === '/api/firmware/versions') {
    const espDir = path.join(FIRMWARE_ROOT, 'esp32');
    if (!fs.existsSync(espDir)) {
      sendJson(res, 200, { device, versions: [] }, { 'Cache-Control': 'public, max-age=60' });
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
                releasedAt: manifest.releasedAt || new Date().toISOString()
              });
            } catch {}
          }
        }
      }

      // Sort versions in descending semver order (1.0.10 > 1.0.9)
      versions.sort((a, b) => compareSemver(b.version, a.version));

      sendJson(res, 200, { device, versions }, {
        'Cache-Control': 'public, max-age=60'
      });
    } catch (err) {
      console.error('[Firmware API] Error scanning versions:', err.message);
      sendError(res, 500, 'Firmware service unavailable');
    }
    return true;
  }

  // 3. GET /api/firmware/:version/manifest
  const manifestMatch = reqPath.match(/^\/api\/firmware\/([^\/]+)\/manifest$/);
  if (manifestMatch) {
    const version = manifestMatch[1];
    if (!SEMVER_REGEX.test(version) || version.includes('..')) {
      sendError(res, 400, 'Invalid firmware version');
      return true;
    }

    const manifestPath = path.join(FIRMWARE_ROOT, 'esp32', version, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      sendError(res, 404, 'Manifest not found for version');
      return true;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      sendJson(res, 200, manifest, {
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
    } catch (err) {
      console.error(`[Firmware API] Error reading manifest for ${version}:`, err.message);
      sendError(res, 500, 'Firmware service unavailable');
    }
    return true;
  }

  // 4. GET /api/firmware/:version
  const versionMatch = reqPath.match(/^\/api\/firmware\/([^\/]+)$/);
  if (versionMatch) {
    const version = versionMatch[1];
    if (!SEMVER_REGEX.test(version) || version.includes('..')) {
      sendError(res, 400, 'Invalid firmware version');
      return true;
    }

    const versionDir = path.join(FIRMWARE_ROOT, 'esp32', version);
    const manifestPath = path.join(versionDir, 'manifest.json');

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
        releasedAt: manifest.releasedAt || new Date().toISOString()
      }, {
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
    } catch (err) {
      console.error(`[Firmware API] Error loading version ${version}:`, err.message);
      sendError(res, 500, 'Firmware service unavailable');
    }
    return true;
  }

  return false;
}

const sseClients = new Set();

function broadcastSse(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

/**
 * Firmware Binary Streaming Handler
 */
function handleFirmwareBinaryStream(req, res, reqPath) {
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
    let bytesSent = 0;
    let lastSentPct = -1;

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': totalSize,
      'Content-Disposition': `attachment; filename="firmware-${version}.bin"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });

    broadcastSse({
      type: 'OTA_START',
      version,
      totalSize,
      status: 'DOWNLOADING',
      message: `ESP32 connected! Delivering v${version} binary...`
    });

    const stream = fs.createReadStream(binaryPath);
    
    stream.on('data', (chunk) => {
      bytesSent += chunk.length;
      const pct = Math.min(100, Math.round((bytesSent / totalSize) * 100));
      if (pct !== lastSentPct && pct % 2 === 0) {
        lastSentPct = pct;
        broadcastSse({
          type: 'OTA_PROGRESS',
          version,
          pct,
          bytesSent,
          totalSize,
          status: pct >= 100 ? 'REBOOTING' : 'DOWNLOADING'
        });
      }
    });

    stream.on('end', () => {
      broadcastSse({
        type: 'OTA_COMPLETE',
        version,
        pct: 100,
        bytesSent: totalSize,
        totalSize,
        status: 'REBOOTING',
        message: 'Binary successfully received by ESP32. Writing to Flash & Rebooting...'
      });
    });

    stream.on('error', (streamErr) => {
      console.error(`[Firmware Stream] Stream error for ${version}:`, streamErr.message);
      broadcastSse({
        type: 'OTA_ERROR',
        version,
        message: streamErr.message
      });
      if (!res.headersSent) {
        sendError(res, 500, 'Firmware transmission failed');
      }
    });

    stream.pipe(res);
  });

  return true;
}

/**
 * Master HTTP Server
 */
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let reqPath = urlObj.pathname;

  // 1. Health check route
  if (reqPath === '/api/health') {
    sendJson(res, 200, {
      status: 'ok',
      device: 'esp32-robot',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  // 1.1 Live SSE Firmware Progress Stream for OTA
  if (reqPath === '/api/firmware/live-stream' || reqPath === '/api/ota/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('data: {"type":"CONNECTED"}\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. Firmware API Routes
  if (reqPath.startsWith('/api/firmware')) {
    if (handleFirmwareApi(req, res, reqPath, urlObj)) {
      return;
    }
  }

  // 3. Firmware Binary Streaming
  if (reqPath.startsWith('/firmware/')) {
    if (handleFirmwareBinaryStream(req, res, reqPath)) {
      return;
    }
  }

  // 4. Prevent API and Firmware requests from ever falling back to index.html
  if (reqPath.startsWith('/api/')) {
    sendError(res, 404, `API route not found: ${reqPath}`);
    return;
  }
  if (reqPath.startsWith('/firmware/')) {
    sendError(res, 404, `Firmware file not found: ${reqPath}`);
    return;
  }

  // 5. Static PWA & SPA Routing
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  // Fallback to index.html for SPA routing if path doesn't exist
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendError(res, 404, '404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Instant update cache rules
    let cacheControl = 'public, max-age=31536000, immutable';
    if (ext === '.html' || filePath.endsWith('sw.js') || ext === '.webmanifest' || filePath.endsWith('registerSW.js')) {
      cacheControl = 'no-cache, no-store, must-revalidate, max-age=0';
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(` 🚀 ESP32 RC Car PWA & Firmware Server is LIVE!`);
  console.log(` 🌐 Local Access:    http://localhost:${PORT}`);
  console.log(` 📡 Firmware API:    http://localhost:${PORT}/api/firmware/latest`);
  console.log(` 📦 Version History: http://localhost:${PORT}/api/firmware/versions`);
  console.log(`======================================================\n`);
});
