/**
 * ESP32 RC Car Zero-Dependency Production Server
 * Entry point delegating to modular server structure in /server
 */
const { server, startServer, wsRelay } = require('./server/app.js');

module.exports = {
  server,
  startServer,
  wsRelay
};
