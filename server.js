/**
 * ESP32 RC Car Production Server Runner
 * Entry point delegating to CommonJS backend server
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { server, startServer, wsRelay } = require('./server/app.js');

startServer();

export { server, startServer, wsRelay };
export default { server, startServer, wsRelay };
