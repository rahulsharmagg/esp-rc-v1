#!/usr/bin/env node
/**
 * Interactive WebSocket Test Client for ESP-RC Relay Server
 * Usage:
 *   node scripts/test-ws.js
 *   node scripts/test-ws.js ws://localhost:8080/ws
 */

const readline = require('readline');
const { WebSocket } = require('ws');

const serverUrl = process.argv[2] || 'wss://rc.codeblaze.in/ws';

console.log('====================================================');
console.log(`Connecting to WebSocket: ${serverUrl}`);
console.log('====================================================');

const ws = new WebSocket(serverUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'ws> '
});

function send(payload) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log('⚠️ WebSocket is not open! Current state:', ws.readyState);
    return;
  }
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  ws.send(data);
  console.log('➡️ Sent:', data);
}

ws.on('open', () => {
  console.log('✅ Connected successfully!');
  console.log('\nCommands you can type:');
  console.log('  ping                          -> Test server latency');
  console.log('  join <sessionCode>            -> Register as browser client');
  console.log('  esp <sessionCode>             -> Register as ESP32');
  console.log('  ota <sessionCode> <pct>       -> Send OTA progress (0-100%)');
  console.log('  {"any":"json"}                -> Send raw JSON object');
  console.log('  exit                          -> Quit\n');
  rl.prompt();
});

ws.on('message', (data) => {
  try {
    const parsed = JSON.parse(data.toString());
    console.log('\n📩 Received JSON:');
    console.dir(parsed, { depth: null, colors: true });
  } catch {
    console.log('\n📩 Received Text:', data.toString());
  }
  rl.prompt();
});

ws.on('close', (code, reason) => {
  console.log(`\n❌ WebSocket disconnected (Code: ${code}, Reason: ${reason || 'none'})`);
  rl.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('\n⚠️ WebSocket error:', err.message);
  rl.prompt();
});

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  if (input === 'exit' || input === 'quit') {
    ws.close();
    rl.close();
    return;
  }

  // Pre-configured shortcuts
  if (input.toLowerCase() === 'ping') {
    send({ type: 'PING' });
  } else if (input.toLowerCase().startsWith('join ')) {
    const code = input.substring(5).trim();
    send({ type: 'REGISTER_SESSION', sessionCode: code, role: 'browser' });
  } else if (input.toLowerCase().startsWith('esp ')) {
    const code = input.substring(4).trim();
    send({ type: 'REGISTER_SESSION', sessionCode: code, role: 'esp32' });
  } else if (input.toLowerCase().startsWith('ota ')) {
    const parts = input.substring(4).trim().split(/\s+/);
    const code = parts[0];
    const pct = parseInt(parts[1] || '50', 10);
    send({
      type: 'OTA_PROGRESS',
      sessionCode: code,
      pct,
      bytesSent: pct * 18000,
      totalSize: 1800000,
      status: pct >= 100 ? 'REBOOTING' : 'FLASHING'
    });
  } else if (input.startsWith('{')) {
    try {
      const parsed = JSON.parse(input);
      send(parsed);
    } catch (e) {
      console.log('Invalid JSON syntax:', e.message);
    }
  } else {
    // Send raw text or message wrapper
    send({ type: 'TEXT', text: input });
  }

  rl.prompt();
});
