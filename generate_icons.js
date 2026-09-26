// Simple script to generate valid 192x192 and 512x512 PNG icons using basic PNG header/chunks or canvas
const fs = require('fs');
const path = require('path');

// We can create a simple minimal valid PNG or write an uncompressed PNG bitmap
function createSolidColorPng(width, height, r, g, b) {
  // Minimal PNG generator using zlib
  const zlib = require('zlib');
  
  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(width, 0);
  IHDR.writeUInt32BE(height, 4);
  IHDR.writeUInt8(8, 8); // bit depth
  IHDR.writeUInt8(2, 9); // color type 2: RGB
  IHDR.writeUInt8(0, 10); // compression
  IHDR.writeUInt8(0, 11); // filter
  IHDR.writeUInt8(0, 12); // interlace

  const rowSize = width * 3 + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 3;
      // create a subtle cyan to dark blue gradient
      const factor = (x + y) / (width + height);
      rawData[pxOffset] = Math.floor(6 + factor * 50);     // R
      rawData[pxOffset + 1] = Math.floor(182 - factor * 80); // G
      rawData[pxOffset + 2] = Math.floor(212 - factor * 20); // B
    }
  }

  const idatData = zlib.deflateSync(rawData);

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(8 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    // Calculate CRC32
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  // Basic CRC32 table
  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', IHDR);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);
}

// Build CRC table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), createSolidColorPng(192, 192, 6, 182, 212));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), createSolidColorPng(512, 512, 6, 182, 212));

console.log('PNG icons created successfully!');
