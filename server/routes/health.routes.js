import { HealthController } from '../controllers/health.controller.js';

export function handleHealthRoutes(req, res, reqPath) {
  if (reqPath === '/api/health') {
    HealthController.getHealth(req, res);
    return true;
  }
  return false;
}
