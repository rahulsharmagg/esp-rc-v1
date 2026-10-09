import http from 'http';
import { PORT, HOST, PUBLIC_DIR, FIRMWARE_ROOT } from './config/index.js';
import { masterRouter } from './routes/index.js';
import { WebSocketRelay } from './ws/relay.js';

// Initialize WebSocket Relay
const wsRelay = new WebSocketRelay();

/**
 * Master HTTP Server
 */
export const server = http.createServer((req, res) => {
  masterRouter(req, res);
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
    console.log(` 🚀 ESP32 RC Car Modular Server (MVC) is LIVE!`);
    console.log(` 🌐 Local Access:    http://localhost:${port}`);
    console.log(` 📤 Binary Upload:   http://localhost:${port}/upload`);
    console.log(` 📡 Firmware API:    http://localhost:${port}/api/firmware/latest`);
    console.log(` 📦 Version History: http://localhost:${port}/api/firmware/versions`);
    console.log(` 🔌 WebSocket Relay: ws://localhost:${port}/ws`);
    console.log(` 📂 Public Root:     ${PUBLIC_DIR}`);
    console.log(`======================================================\n`);
  });
}

// Auto-start if executed directly or via server.js
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('app.js'))) {
  startServer();
}

export { wsRelay };
