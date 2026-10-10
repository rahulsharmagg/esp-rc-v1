const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../..');

// Support numeric ports, Unix sockets, named pipes, and Passenger in cPanel
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'rcadmin';
const NODE_ENV = process.env.NODE_ENV || 'production';

// Public static assets resolution for cPanel & production
const PUBLIC_DIR = fs.existsSync(path.join(ROOT_DIR, 'public', 'index.html'))
  ? path.join(ROOT_DIR, 'public')
  : fs.existsSync(path.join(ROOT_DIR, 'dist', 'index.html'))
    ? path.join(ROOT_DIR, 'dist')
    : fs.existsSync(path.join(ROOT_DIR, 'public'))
      ? path.join(ROOT_DIR, 'public')
      : ROOT_DIR;

const FIRMWARE_ROOT = path.join(ROOT_DIR, 'firmware');
const SUPPORTED_DEVICES = ['esp32-robot'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB upload ceiling

module.exports = {
  ROOT_DIR,
  PORT,
  HOST,
  ADMIN_PASSWORD,
  NODE_ENV,
  PUBLIC_DIR,
  FIRMWARE_ROOT,
  SUPPORTED_DEVICES,
  MAX_UPLOAD_BYTES
};
