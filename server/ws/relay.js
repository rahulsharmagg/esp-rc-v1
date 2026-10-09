import { WebSocketServer, WebSocket } from 'ws';

/**
 * Session-based WebSocket Relay powered by standard 'ws' library
 * Matches session codes between Cockpit browser client and ESP32 microcontroller
 */
export class WebSocketRelay {
  constructor() {
    this.sessions = new Map(); // sessionCode -> { browserWs, espWs, createdAt }
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress || 'unknown';
      console.log(`[WS Relay] Client connected from ${clientIp}`);

      ws.clientSessionCode = null;
      ws.clientRole = null;

      // Connection welcome banner
      this.send(ws, {
        type: 'WELCOME',
        message: 'Connected to ESP-RC Cloud WebSocket Relay',
        timestamp: new Date().toISOString()
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        this.handleTextMessage(ws, data.toString());
      });

      ws.on('close', () => {
        if (ws.clientSessionCode && this.sessions.has(ws.clientSessionCode)) {
          const sess = this.sessions.get(ws.clientSessionCode);
          if (sess.browserWs === ws) sess.browserWs = null;
          if (sess.espWs === ws) sess.espWs = null;
          if (!sess.browserWs && !sess.espWs) {
            this.sessions.delete(ws.clientSessionCode);
          }
        }
        console.log(`[WS Relay] Client disconnected (${clientIp})`);
      });

      ws.on('error', (err) => {
        console.error(`[WS Relay Error] ${err.message}`);
      });
    });
  }

  /**
   * Delegate HTTP Upgrade request to ws server
   */
  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  /**
   * Helper to send JSON payload
   */
  send(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  /**
   * Process and route WebSocket messages
   */
  handleTextMessage(ws, rawText) {
    try {
      const payload = JSON.parse(rawText);
      const type = payload.type || '';
      const sessionCode = payload.sessionCode || payload.code || ws.clientSessionCode;

      // 1. Session Registration
      if (type === 'REGISTER_SESSION' || type === 'JOIN_SESSION') {
        const code = payload.sessionCode || payload.code;
        const role = payload.role || 'browser';

        if (code) {
          ws.clientSessionCode = code;
          ws.clientRole = role;

          let sess = this.sessions.get(code);
          if (!sess) {
            sess = { browserWs: null, espWs: null, createdAt: Date.now() };
            this.sessions.set(code, sess);
          }

          if (role === 'esp32' || role === 'esp') {
            sess.espWs = ws;
            console.log(`[WS Relay] ESP32 joined session: ${code}`);
            if (sess.browserWs) {
              this.send(sess.browserWs, {
                type: 'ESP_ATTACHED',
                sessionCode: code,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            sess.browserWs = ws;
            console.log(`[WS Relay] Browser client registered session: ${code}`);
          }

          this.send(ws, {
            type: 'SESSION_REGISTERED',
            sessionCode: code,
            role,
            status: 'ok'
          });
        }
        return;
      }

      // 2. OTA Progress Streaming (ESP32 -> Specific Browser Client)
      if (type === 'OTA_PROGRESS' || type === 'OTA_COMPLETE' || type === 'OTA_START' || type === 'OTA_ERROR') {
        if (sessionCode && this.sessions.has(sessionCode)) {
          const sess = this.sessions.get(sessionCode);
          if (sess.browserWs) {
            this.send(sess.browserWs, payload);
            console.log(`[WS Relay] Relayed ${type} to session ${sessionCode} (${payload.pct || 0}%)`);
            return;
          }
        }
        this.broadcast(payload);
        return;
      }

      // 3. Ping / Echo Test
      if (type === 'PING') {
        this.send(ws, { type: 'PONG', time: Date.now() });
        return;
      }

      this.send(ws, {
        type: 'ECHO',
        received: payload,
        serverTime: Date.now()
      });
    } catch {
      this.send(ws, { type: 'ECHO_TEXT', text: rawText });
    }
  }

  /**
   * Broadcast message to all active WebSocket clients
   */
  broadcast(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
