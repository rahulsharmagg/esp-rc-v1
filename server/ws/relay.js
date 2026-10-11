const { WebSocketServer, WebSocket } = require('ws');

/**
 * Bidirectional WebSocket Relay
 * - When ESP sends -> Browser(s) receive
 * - When Browser sends -> ESP(s) receive
 * - Supports targeted session pairing (sessionCode) with automatic role fallback
 */
class WebSocketRelay {
  constructor() {
    this.sessions = new Map(); // sessionCode -> { browserWs, espWs, createdAt }
    this.browsers = new Set();
    this.esps = new Set();
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws, req) => {
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = (forwarded ? String(forwarded).split(',')[0].trim() : null) || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';

      ws.clientSessionCode = null;
      ws.clientRole = null;

      // Auto-detect role from query param (?role=esp32 or ?role=browser) or User-Agent
      const url = req.url || '';
      const ua = req.headers['user-agent'] || '';
      if (url.includes('role=esp') || ua.includes('ESP32') || ua.includes('Arduino')) {
        this.setClientRole(ws, 'esp32');
      } else if (url.includes('role=browser')) {
        this.setClientRole(ws, 'browser');
      }

      console.log(`[WS Relay] Client connected from ${clientIp} (Role: ${ws.clientRole || 'unassigned'})`);

      // Welcome handshake banner
      this.send(ws, {
        type: 'WELCOME',
        message: 'Connected to ESP-RC Cloud WebSocket Relay',
        role: ws.clientRole || 'unassigned',
        timestamp: new Date().toISOString()
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        this.handleTextMessage(ws, data.toString());
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
        console.log(`[WS Relay] Client disconnected (${clientIp})`);
      });

      ws.on('error', (err) => {
        console.error(`[WS Relay Error] ${err.message}`);
      });
    });
  }

  /**
   * Set or update client role ('esp32' | 'browser')
   */
  setClientRole(ws, role) {
    ws.clientRole = role;
    if (role === 'esp32' || role === 'esp') {
      this.esps.add(ws);
      this.browsers.delete(ws);
    } else if (role === 'browser') {
      this.browsers.add(ws);
      this.esps.delete(ws);
    }
  }

  /**
   * Remove client from tracking sets and active sessions
   */
  cleanupClient(ws) {
    this.browsers.delete(ws);
    this.esps.delete(ws);

    if (ws.clientSessionCode && this.sessions.has(ws.clientSessionCode)) {
      const sess = this.sessions.get(ws.clientSessionCode);
      if (sess.browserWs === ws) sess.browserWs = null;
      if (sess.espWs === ws) sess.espWs = null;
      if (!sess.browserWs && !sess.espWs) {
        this.sessions.delete(ws.clientSessionCode);
      }
    }
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
      const msg = typeof obj === 'string' ? obj : JSON.stringify(obj);
      ws.send(msg);
    }
  }

  /**
   * Send progress to browser in session or broadcast
   */
  sendProgress(sessionCode, payload) {
    if (sessionCode && this.sessions.has(sessionCode)) {
      const sess = this.sessions.get(sessionCode);
      if (sess.browserWs && sess.browserWs.readyState === WebSocket.OPEN) {
        this.send(sess.browserWs, payload);
        return;
      }
    }
    // Broadcast fallback to all browsers
    for (const browser of this.browsers) {
      if (browser.readyState === WebSocket.OPEN) {
        this.send(browser, payload);
      }
    }
  }

  /**
   * Process and route WebSocket messages:
   * ESP -> Browser
   * Browser -> ESP
   */
  handleTextMessage(ws, rawText) {
    let payload = null;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { type: 'TEXT', text: rawText };
    }

    const type = payload.type || '';
    const sessionCode = payload.sessionCode || payload.code || ws.clientSessionCode;

    // 1. Role / Session Registration
    if (type === 'REGISTER_SESSION' || type === 'JOIN_SESSION') {
      const code = payload.sessionCode || payload.code;
      const role = payload.role || ws.clientRole || 'browser';
      this.setClientRole(ws, role);

      if (code) {
        ws.clientSessionCode = code;
        let sess = this.sessions.get(code);
        if (!sess) {
          sess = { browserWs: null, espWs: null, createdAt: Date.now() };
          this.sessions.set(code, sess);
        }

        if (role === 'esp32' || role === 'esp') {
          sess.espWs = ws;
          console.log(`[WS Relay] ESP32 registered to session: ${code}`);
          if (sess.browserWs) {
            this.send(sess.browserWs, {
              type: 'ESP_ATTACHED',
              sessionCode: code,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          sess.browserWs = ws;
          console.log(`[WS Relay] Browser registered to session: ${code}`);
          if (sess.espWs) {
            this.send(ws, {
              type: 'ESP_ATTACHED',
              sessionCode: code,
              timestamp: new Date().toISOString()
            });
          }
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

    // 2. Ping / Latency Check
    if (type === 'PING') {
      this.send(ws, { type: 'PONG', time: Date.now() });
      return;
    }

    // If message contains role hint, update tracking
    if (payload.role && !ws.clientRole) {
      this.setClientRole(ws, payload.role);
    }

    // Attach sender role and sessionCode to outgoing payload if not present
    if (!payload.sender) payload.sender = ws.clientRole || 'client';
    if (sessionCode && !payload.sessionCode) payload.sessionCode = sessionCode;

    // 3. Bidirectional Relay Logic:
    // Option A: Specific Session Match
    if (sessionCode && this.sessions.has(sessionCode)) {
      const sess = this.sessions.get(sessionCode);
      const targetWs = (ws === sess.espWs || ws.clientRole === 'esp32') ? sess.browserWs : sess.espWs;
      if (targetWs && targetWs.readyState === WebSocket.OPEN && targetWs !== ws) {
        this.send(targetWs, payload);
        console.log(`[WS Relay] Forwarded ${type || 'MSG'} to session peer [${sessionCode}]`);
        return;
      }
    }

    // Option B: ESP -> ALL Browsers
    if (ws.clientRole === 'esp32' || ws.clientRole === 'esp') {
      let count = 0;
      for (const browser of this.browsers) {
        if (browser.readyState === WebSocket.OPEN && browser !== ws) {
          this.send(browser, payload);
          count++;
        }
      }
      console.log(`[WS Relay] ESP32 -> Delivered to ${count} browser(s)`);
      if (count > 0) return;
    }

    // Option C: Browser -> ALL ESPs
    if (ws.clientRole === 'browser') {
      let count = 0;
      for (const esp of this.esps) {
        if (esp.readyState === WebSocket.OPEN && esp !== ws) {
          this.send(esp, payload);
          count++;
        }
      }
      console.log(`[WS Relay] Browser -> Delivered to ${count} ESP(s)`);
      if (count > 0) return;
    }

    // Option D: Broadcast fallback to all other clients
    this.broadcast(payload, ws);
    console.log(`[WS Relay] Broadcasted message to all other connected clients`);
  }

  /**
   * Broadcast message to all active WebSocket clients (excluding sender)
   */
  broadcast(message, excludeWs = null) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
        client.send(data);
      }
    }
  }
}

module.exports = {
  WebSocketRelay
};
