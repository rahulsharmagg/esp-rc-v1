/**
 * RFC 6455 WebSocket Frame Utilities (Zero Dependencies)
 */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Encodes a text/JSON message into an unmasked server-to-client RFC 6455 frame
 */
export function createWsFrame(message) {
  const payload = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message));
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Parses client-to-server RFC 6455 frames (handles masking, unmasking, opcode detection)
 */
export function parseWsFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte0 = buffer[offset];
    const byte1 = buffer[offset + 1];

    const isFin = (byte0 & 0x80) === 0x80;
    const opcode = byte0 & 0x0f;
    const isMasked = (byte1 & 0x80) === 0x80;
    let payloadLen = byte1 & 0x7f;

    let headerSize = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerSize = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerSize = 10;
    }

    const maskSize = isMasked ? 4 : 0;
    const totalFrameSize = headerSize + maskSize + payloadLen;

    if (offset + totalFrameSize > buffer.length) {
      // Incomplete frame, await more chunks
      break;
    }

    // Control frame: Close
    if (opcode === 0x08) {
      messages.push({ type: 'CLOSE', code: buffer.readUInt16BE(offset + headerSize) || 1000 });
      offset += totalFrameSize;
      continue;
    }

    // Control frame: Ping
    if (opcode === 0x09) {
      messages.push({ type: 'PING' });
      offset += totalFrameSize;
      continue;
    }

    // Data frame: Text or Binary
    let payloadBuffer;
    if (isMasked) {
      const maskKey = buffer.slice(offset + headerSize, offset + headerSize + 4);
      const rawData = buffer.slice(offset + headerSize + 4, offset + totalFrameSize);
      payloadBuffer = Buffer.alloc(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        payloadBuffer[i] = rawData[i] ^ maskKey[i % 4];
      }
    } else {
      payloadBuffer = buffer.slice(offset + headerSize, offset + totalFrameSize);
    }

    if (opcode === 0x01) {
      messages.push({ type: 'TEXT', data: payloadBuffer.toString('utf8') });
    } else if (opcode === 0x02) {
      messages.push({ type: 'BINARY', data: payloadBuffer });
    }

    offset += totalFrameSize;
  }

  return { messages, consumedBytes: offset };
}
