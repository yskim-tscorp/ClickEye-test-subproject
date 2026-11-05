'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDb, migrate, addUser, normalizeEmail } = require('./db');
const { hashPassword } = require('./auth');

const MAX_BODY = 10 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const SIGNUP_HTML = path.join(__dirname, '..', 'public', 'signup.html');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'",
};

// 오류 응답은 이 헬퍼 한 곳에서만 만든다: {code, message, details:[{field,message}]}
function sendError(res, status, code, message, details = []) {
  send(res, status, { code, message, details });
}

function send(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(data);
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다. 10KB 이하로 보내 주세요.'));
        req.pause();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 서버가 검증의 정본이다. 화면은 details 를 필드 옆에 보여 줄 뿐이다.
function validate(input) {
  const details = [];
  const email = input && typeof input.email === 'string' ? normalizeEmail(input.email) : '';
  const password = input && typeof input.password === 'string' ? input.password : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    details.push({ field: 'email', message: '이메일 형식이 올바르지 않습니다. 예: name@example.com' });
  }
  if ([...password].length < 8) {
    details.push({ field: 'password', message: '비밀번호는 8자 이상이어야 합니다. 더 길게 입력해 주세요.' });
  } else if ([...password].length > 128) {
    details.push({ field: 'password', message: '비밀번호는 128자 이하여야 합니다. 더 짧게 입력해 주세요.' });
  }
  return { details, email, password };
}

async function handleSignup(db, req, res) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 은 application/json 이어야 합니다.');
  }
  const raw = await readBody(req);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '요청 본문이 올바른 JSON 이 아닙니다.');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'INVALID_JSON', '요청 본문은 JSON 객체여야 합니다.');
  }
  const { details, email, password } = validate(input);
  if (details.length) {
    return sendError(res, 400, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', details);
  }
  const passwordHash = await hashPassword(password);
  const result = addUser(db, { email, passwordHash });
  if (!result.ok) {
    return sendError(res, 409, 'EMAIL_TAKEN', '이미 가입된 이메일입니다. 다른 이메일을 쓰거나 로그인해 주세요.', [
      { field: 'email', message: '이미 가입된 이메일입니다.' },
    ]);
  }
  send(res, 201, { id: result.id, email });
}

// listen 하지 않는 http.Server 를 돌려준다. logger 는 비밀번호·본문을 받지 않는다.
function createServer(db, { logger = console } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/api/signup') {
        return await handleSignup(db, req, res);
      }
      if (req.method === 'GET' && (url.pathname === '/signup' || url.pathname === '/signup.html')) {
        const html = fs.readFileSync(SIGNUP_HTML);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        return res.end(html);
      }
      sendError(res, 404, 'NOT_FOUND', '요청한 경로를 찾을 수 없습니다.');
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendError(res, err.status, err.code, err.message);
        return;
      }
      const traceId = randomUUID();
      logger.error(`[${traceId}] unexpected error: ${err && err.name}`); // 본문·비밀번호는 남기지 않는다
      if (!res.headersSent) {
        send(res, 500, { code: 'INTERNAL_ERROR', message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', details: [], trace_id: traceId });
      }
    }
  });
}

if (require.main === module) {
  const db = openDb(process.env.SIGNUP_DB_PATH || 'signup.db');
  migrate(db);
  const port = Number(process.env.PORT || 3000);
  createServer(db).listen(port, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${port}/signup`));
}

module.exports = { createServer };
