import crypto from 'crypto';
import { WS_GUID, createWsFrame, parseWsFrames } from './frame.js';

/**
 * Session-based WebSocket Relay
 * Matches session codes between Cockpit browser client and ESP32 microcontroller
 */
export class WebSocketRelay {
  constructor() {
    this.sessions = new Map(); // sessionCode -> { browserSocket, espSocket, lastSeen }
    this.clients = new Set();
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ];
    socket.write(responseHeaders.join('\r\n'));

    const clientIp = socket.remoteAddress || 'unknown';
    console.log(`[WS Relay] Client connected from ${clientIp}`);

    this.clients.add(socket);
    socket.clientSessionCode = null;
    socket.clientRole = null;

    // Send connection greeting
    socket.write(createWsFrame({
      type: 'WELCOME',
      message: 'Connected to ESP-RC Cloud WebSocket Relay',
      timestamp: new Date().toISOString()
    }));

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { messages, consumedBytes } = parseWsFrames(buffer);

      if (consumedBytes > 0) {
        buffer = buffer.slice(consumedBytes);
      }

      for (const msg of messages) {
        if (msg.type === 'PING') {
          socket.write(Buffer.from([0x8a, 0x00])); // Pong
        } else if (msg.type === 'CLOSE') {
          socket.end();
        } else if (msg.type === 'TEXT') {
          this.handleTextMessage(socket, msg.data);
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      if (socket.clientSessionCode && this.sessions.has(socket.clientSessionCode)) {
        const sess = this.sessions.get(socket.clientSessionCode);
        if (sess.browserSocket === socket) sess.browserSocket = null;
        if (sess.espSocket === socket) sess.espSocket = null;
        if (!sess.browserSocket && !sess.espSocket) {
          this.sessions.delete(socket.clientSessionCode);
        }
      }
      console.log(`[WS Relay] Client disconnected (${clientIp})`);
    });

    socket.on('error', (err) => {
      console.error(`[WS Relay Error] ${err.message}`);
      socket.destroy();
    });
  }

  handleTextMessage(socket, rawText) {
    try {
      const payload = JSON.parse(rawText);
      const type = payload.type || '';
      const sessionCode = payload.sessionCode || payload.code || socket.clientSessionCode;

      // 1. Session Registration
      if (type === 'REGISTER_SESSION' || type === 'JOIN_SESSION') {
        const code = payload.sessionCode || payload.code;
        const role = payload.role || 'browser';

        if (code) {
          socket.clientSessionCode = code;
          socket.clientRole = role;

          let sess = this.sessions.get(code);
          if (!sess) {
            sess = { browserSocket: null, espSocket: null, createdAt: Date.now() };
            this.sessions.set(code, sess);
          }

          if (role === 'esp32' || role === 'esp') {
            sess.espSocket = socket;
            console.log(`[WS Relay] ESP32 joined session: ${code}`);
            // Notify browser that ESP32 has attached
            if (sess.browserSocket && sess.browserSocket.writable) {
              sess.browserSocket.write(createWsFrame({
                type: 'ESP_ATTACHED',
                sessionCode: code,
                timestamp: new Date().toISOString()
              }));
            }
          } else {
            sess.browserSocket = socket;
            console.log(`[WS Relay] Browser client registered session: ${code}`);
          }

          socket.write(createWsFrame({
            type: 'SESSION_REGISTERED',
            sessionCode: code,
            role,
            status: 'ok'
          }));
        }
        return;
      }

      // 2. OTA Progress Streaming (ESP32 -> Specific Browser Client)
      if (type === 'OTA_PROGRESS' || type === 'OTA_COMPLETE' || type === 'OTA_START' || type === 'OTA_ERROR') {
        if (sessionCode && this.sessions.has(sessionCode)) {
          const sess = this.sessions.get(sessionCode);
          if (sess.browserSocket && sess.browserSocket.writable) {
            sess.browserSocket.write(createWsFrame(payload));
            console.log(`[WS Relay] Relayed ${type} to session ${sessionCode} (${payload.pct || 0}%)`);
            return;
          }
        }
        // Fallback: broadcast to all connected web clients if session expired
        this.broadcast(payload);
        return;
      }

      // 3. Generic Ping / Echo Testing
      if (type === 'PING') {
        socket.write(createWsFrame({ type: 'PONG', time: Date.now() }));
        return;
      }

      // Echo confirmation
      socket.write(createWsFrame({
        type: 'ECHO',
        received: payload,
        serverTime: Date.now()
      }));
    } catch (e) {
      // Non-JSON plain text frame: Echo back
      socket.write(createWsFrame({ type: 'ECHO_TEXT', text: rawText }));
    }
  }

  broadcast(message) {
    const frame = createWsFrame(message);
    for (const client of this.clients) {
      if (client.writable) {
        try { client.write(frame); } catch (_) { this.clients.delete(client); }
      }
    }
  }
}
