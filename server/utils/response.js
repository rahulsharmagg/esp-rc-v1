/**
 * Pure Node.js HTTP Response Utilities (Zero Dependencies)
 */
function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': '*',
    ...headers
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

module.exports = {
  sendJson,
  sendError
};
