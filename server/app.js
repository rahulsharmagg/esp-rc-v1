import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { handleHealth } from './routes/health.js';
import { createFirmwareHandler } from './routes/firmware.js';
import { createStaticHandler } from './routes/static.js';
import { WebSocketRelay } from './ws/relay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'rcadmin';

const PUBLIC_DIR = fs.existsSync(path.join(ROOT_DIR, 'public', 'index.html'))
  ? path.join(ROOT_DIR, 'public')
  : fs.existsSync(path.join(ROOT_DIR, 'dist', 'index.html'))
    ? path.join(ROOT_DIR, 'dist')
    : fs.existsSync(path.join(ROOT_DIR, 'public'))
      ? path.join(ROOT_DIR, 'public')
      : ROOT_DIR;

const FIRMWARE_ROOT = path.join(ROOT_DIR, 'firmware');

// Initialize route handlers
const handleFirmware = createFirmwareHandler({
  firmwareRoot: FIRMWARE_ROOT,
  adminPassword: ADMIN_PASSWORD
});

const handleStatic = createStaticHandler({
  publicDir: PUBLIC_DIR
});

// Initialize WebSocket Relay
const wsRelay = new WebSocketRelay();

/**
 * Master HTTP Server
 */
export const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = urlObj.pathname;

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  // 1. Health check
  if (reqPath === '/api/health') {
    handleHealth(req, res);
    return;
  }

  // 2. Firmware API and Binary routes
  if (reqPath.startsWith('/api/firmware') || reqPath.startsWith('/firmware/')) {
    if (handleFirmware(req, res, reqPath, urlObj)) {
      return;
    }
  }

  // 3. Static Files & SPA Routing
  handleStatic(req, res, reqPath);
});

// Attach WebSocket Upgrade Handler
server.on('upgrade', (req, socket, head) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (urlObj.pathname === '/ws') {
    wsRelay.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

export function startServer(port = PORT, host = HOST) {
  return server.listen(port, host, () => {
    console.log(`\n======================================================`);
    console.log(` 🚀 ESP32 RC Car Modular Server is LIVE!`);
    console.log(` 🌐 Local Access:    http://localhost:${port}`);
    console.log(` 📤 Binary Upload:   http://localhost:${port}/upload`);
    console.log(` 📡 Firmware API:    http://localhost:${port}/api/firmware/latest`);
    console.log(` 📦 Version History: http://localhost:${port}/api/firmware/versions`);
    console.log(` 🔌 WebSocket Relay: ws://localhost:${port}/ws`);
    console.log(`======================================================\n`);
  });
}

// Auto-start if executed directly or via server.js
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('app.js'))) {
  startServer();
}

export { wsRelay };
