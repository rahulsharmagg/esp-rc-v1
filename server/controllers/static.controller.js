const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../config/index.js');
const { sendError } = require('../utils/response.js');

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
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

class StaticController {
  static serveStatic(req, res, reqPath) {
    // 1. Prevent API and Firmware requests from ever falling back to index.html
    if (reqPath.startsWith('/api/')) {
      sendError(res, 404, `API route not found: ${reqPath}`);
      return true;
    }
    if (reqPath.startsWith('/firmware/')) {
      sendError(res, 404, `Firmware binary not found: ${reqPath}`);
      return true;
    }

    // 2. Static File & SPA Routing Resolution
    let targetPath = reqPath;
    if (targetPath === '/' || targetPath === '') {
      targetPath = '/index.html';
    }

    const safePath = path.normalize(targetPath).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(PUBLIC_DIR, safePath);

    // Fallback to index.html for SPA routes (e.g. /upload, /cockpit)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        sendError(res, 404, '404 File Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

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

    return true;
  }
}

module.exports = {
  StaticController
};
