import { FirmwareController } from '../controllers/firmware.controller.js';

export function handleFirmwareRoutes(req, res, reqPath, urlObj) {
  // 0. POST /api/firmware/upload
  if (reqPath === '/api/firmware/upload' && req.method === 'POST') {
    FirmwareController.handleUpload(req, res, urlObj);
    return true;
  }

  // 1. GET /api/firmware/latest
  if (reqPath === '/api/firmware/latest') {
    FirmwareController.getLatest(req, res, urlObj);
    return true;
  }

  // 2. GET /api/firmware/versions
  if (reqPath === '/api/firmware/versions') {
    FirmwareController.getVersions(req, res, urlObj);
    return true;
  }

  // 3. GET /api/firmware/:version/manifest
  const manifestMatch = reqPath.match(/^\/api\/firmware\/([^\/]+)\/manifest$/);
  if (manifestMatch) {
    FirmwareController.getManifest(req, res, manifestMatch[1]);
    return true;
  }

  // 4. GET /api/firmware/:version
  const versionMatch = reqPath.match(/^\/api\/firmware\/([^\/]+)$/);
  if (versionMatch) {
    FirmwareController.getVersionInfo(req, res, versionMatch[1], urlObj);
    return true;
  }

  // 5. Binary file streaming: /firmware/esp32/:version/firmware.bin
  const binaryMatch = reqPath.match(/^\/firmware\/esp32\/([^\/]+)\/firmware\.bin$/);
  if (binaryMatch) {
    return FirmwareController.streamBinary(req, res, binaryMatch[1]);
  }

  return false;
}
