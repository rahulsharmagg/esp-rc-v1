import { sendJson } from '../utils/response.js';

export function handleHealth(req, res) {
  sendJson(res, 200, {
    status: 'ok',
    device: 'esp32-robot',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
}
