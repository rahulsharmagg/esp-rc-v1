/**
 * Pure Zero-Dependency Multipart/Form-Data Parser
 */
function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from('--' + boundary);
  const result = { fields: {}, files: {} };
  let start = buffer.indexOf(boundaryBuffer);

  while (start !== -1) {
    start += boundaryBuffer.length;
    if (buffer.slice(start, start + 2).toString() === '--') {
      break;
    }
    if (buffer.slice(start, start + 2).toString() === '\r\n') {
      start += 2;
    }

    const nextBoundary = buffer.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    const partBuffer = buffer.slice(start, nextBoundary - 2);
    const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerStr = partBuffer.slice(0, headerEnd).toString('utf8');
      const body = partBuffer.slice(headerEnd + 4);

      const nameMatch = headerStr.match(/name="([^"]+)"/);
      const filenameMatch = headerStr.match(/filename="([^"]+)"/);

      if (nameMatch) {
        const name = nameMatch[1];
        if (filenameMatch) {
          result.files[name] = {
            filename: filenameMatch[1],
            data: body,
            size: body.length
          };
        } else {
          result.fields[name] = body.toString('utf8').trim();
        }
      }
    }

    start = nextBoundary;
  }

  return result;
}

module.exports = {
  parseMultipart
};
