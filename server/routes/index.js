import { handleHealthRoutes } from './health.routes.js';
import { handleFirmwareRoutes } from './firmware.routes.js';
import { handleStaticRoutes } from './static.routes.js';

export function masterRouter(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = urlObj.pathname;

  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return true;
  }

  // 2. Health check routes
  if (handleHealthRoutes(req, res, reqPath)) {
    return true;
  }

  // 3. Firmware API & Streaming routes
  if (handleFirmwareRoutes(req, res, reqPath, urlObj)) {
    return true;
  }

  // 4. Static PWA & SPA fallback routes
  return handleStaticRoutes(req, res, reqPath);
}

export { handleHealthRoutes, handleFirmwareRoutes, handleStaticRoutes };
