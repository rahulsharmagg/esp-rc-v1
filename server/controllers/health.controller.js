const { sendJson } = require('../utils/response.js');

class HealthController {
  static getHealth(req, res) {
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }, {
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
    });
  }
}

module.exports = {
  HealthController
};
