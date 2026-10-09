/**
 * Pure Node.js HTTP Response Utilities (Zero Dependencies)
 */
export function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': '*',
    ...headers
  });
  res.end(JSON.stringify(data, null, 2));
}

export function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}
