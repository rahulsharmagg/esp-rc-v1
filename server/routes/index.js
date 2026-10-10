const { HealthController } = require('../controllers/health.controller.js');
const { FirmwareController } = require('../controllers/firmware.controller.js');
const { StaticController } = require('../controllers/static.controller.js');

/**
 * Single Route Registry Table & Master Request Dispatcher
 * Maps all HTTP endpoints to corresponding Controller actions
 */
function masterRouter(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = urlObj;
  const method = req.method;

  // 1. Global CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return true;
  }

  // ==========================================
  // 2. Health Check Routes
  // ==========================================
  if (method === 'GET' && pathname === '/api/health') {
    HealthController.getHealth(req, res);
    return true;
  }

  // ==========================================
  // 3. Firmware Management & Upload Routes
  // ==========================================
  if (method === 'POST' && pathname === '/api/firmware/upload') {
    FirmwareController.handleUpload(req, res, urlObj);
    return true;
  }

  if (method === 'GET' && pathname === '/api/firmware/latest') {
    FirmwareController.getLatest(req, res, urlObj);
    return true;
  }

  if (method === 'GET' && pathname === '/api/firmware/versions') {
    FirmwareController.getVersions(req, res, urlObj);
    return true;
  }

  const manifestMatch = pathname.match(/^\/api\/firmware\/([^\/]+)\/manifest$/);
  if (method === 'GET' && manifestMatch) {
    FirmwareController.getManifest(req, res, manifestMatch[1]);
    return true;
  }

  const versionMatch = pathname.match(/^\/api\/firmware\/([^\/]+)$/);
  if (method === 'GET' && versionMatch) {
    FirmwareController.getVersionInfo(req, res, versionMatch[1], urlObj);
    return true;
  }

  // ==========================================
  // 4. Binary Streaming Routes (ESP32 OTA)
  // ==========================================
  const binaryMatch = pathname.match(/^\/firmware\/esp32\/([^\/]+)\/firmware\.bin$/);
  if (method === 'GET' && binaryMatch) {
    return FirmwareController.streamBinary(req, res, binaryMatch[1]);
  }

  // ==========================================
  // 5. Static Files & SPA Fallback Route
  // ==========================================
  return StaticController.serveStatic(req, res, pathname);
}

module.exports = {
  masterRouter
};
