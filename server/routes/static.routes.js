import { StaticController } from '../controllers/static.controller.js';

export function handleStaticRoutes(req, res, reqPath) {
  return StaticController.serveStatic(req, res, reqPath);
}
