import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '../..');

export const PORT = parseInt(process.env.PORT || '8080', 10);
export const HOST = process.env.HOST || '0.0.0.0';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'rcadmin';

export const PUBLIC_DIR = fs.existsSync(path.join(ROOT_DIR, 'public', 'index.html'))
  ? path.join(ROOT_DIR, 'public')
  : fs.existsSync(path.join(ROOT_DIR, 'dist', 'index.html'))
    ? path.join(ROOT_DIR, 'dist')
    : fs.existsSync(path.join(ROOT_DIR, 'public'))
      ? path.join(ROOT_DIR, 'public')
      : ROOT_DIR;

export const FIRMWARE_ROOT = path.join(ROOT_DIR, 'firmware');
export const SUPPORTED_DEVICES = ['esp32-robot'];
