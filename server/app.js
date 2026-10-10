const http = require('http');
const { PORT, HOST, PUBLIC_DIR } = require('./config/index.js');
const { masterRouter } = require('./routes/index.js');
const { WebSocketRelay } = require('./ws/relay.js');

// Initialize WebSocket Relay
const wsRelay = new WebSocketRelay();

/**
 * Master HTTP Server
 */
const server = http.createServer((req, res) => {
  try {
    masterRouter(req, res);
  } catch (err) {
    console.error('[Server Error]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
});

// Optimize Keep-Alive timeouts for cPanel Apache / LiteSpeed reverse proxy
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Attach WebSocket Upgrade Handler
server.on('upgrade', (req, socket, head) => {
  try {
    const hostHeader = req.headers.host || 'localhost';
    const urlObj = new URL(req.url, `http://${hostHeader}`);
    if (urlObj.pathname === '/ws') {
      wsRelay.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  } catch (err) {
    console.error('[Upgrade Error]', err);
    socket.destroy();
  }
});

/**
 * Start Server with cPanel / Passenger socket & port auto-detection
 */
function startServer(port = PORT, host = HOST) {
  const isNumericPort = typeof port === 'number' || /^\d+$/.test(String(port));

  const onListen = () => {
    const boundTarget = isNumericPort ? `http://${host}:${port}` : String(port);
    console.log(`\n======================================================`);
    console.log(` 🚀 ESP32 RC Car Server (cPanel Optimized) is LIVE!`);
    console.log(` 🌐 Target:          ${boundTarget}`);
    console.log(` 📤 Binary Upload:   /upload`);
    console.log(` 📡 Firmware API:    /api/firmware/latest`);
    console.log(` 📦 Version History: /api/firmware/versions`);
    console.log(` 🔌 WebSocket Relay: /ws`);
    console.log(` 📂 Public Root:     ${PUBLIC_DIR}`);
    console.log(`======================================================\n`);
  };

  if (isNumericPort) {
    return server.listen(Number(port), host, onListen);
  } else {
    // Phusion Passenger / Unix Domain Socket / Named Pipe
    return server.listen(port, onListen);
  }
}

// Graceful Shutdown for cPanel Process Manager / Passenger
function gracefulShutdown(signal) {
  console.log(`\n[cPanel Process] Received ${signal}, performing graceful shutdown...`);
  try {
    wsRelay.broadcast({ type: 'SERVER_SHUTDOWN', message: 'Server is restarting' });
  } catch (_) {}

  server.close(() => {
    console.log('[cPanel Process] Server terminated cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    console.warn('[cPanel Process] Forced shutdown timeout reached.');
    process.exit(0);
  }, 4000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

// Auto-start if executed directly or via server.js / cPanel startup file
if (require.main === module || (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('app.js')))) {
  startServer();
}

module.exports = {
  server,
  startServer,
  wsRelay
};
