'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

// Claims come from the API Gateway JWT authorizer (already verified).
function getUser(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) throw new HttpError(401, 'Not signed in');
  let groups = claims['cognito:groups'] || [];
  if (typeof groups === 'string') groups = groups.replace(/[[\]]/g, '').split(/[ ,]+/).filter(Boolean);
  return { sub: claims.sub, email: claims.email || claims.username || '', groups };
}

function requireRole(user, ...roles) {
  if (!roles.some((r) => user.groups.includes(r))) {
    throw new HttpError(403, `Requires role: ${roles.join(' or ')}`);
  }
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

module.exports = { HttpError, json, getUser, requireRole, parseBody };
