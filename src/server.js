'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb, addUser, findUserByEmail } = require('./db');
const { hashPassword } = require('./auth');

const MAX_BODY = 8 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PAGE = path.join(__dirname, '..', 'public', 'signup.html');
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
};

function send(res, status, type, data) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), ...SEC_HEADERS });
  res.end(data);
}

function sendJson(res, status, body) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

// 모든 오류 응답은 이 한 가지 모양: { code, message, details[], trace_id }
function sendError(res, status, code, message, details = [], traceId) {
  sendJson(res, status, { code, message, details, trace_id: traceId });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // 버리면서 계속 읽어 413 응답이 전달되게 한다(버퍼링은 중단).
        if (!over) { over = true; chunks.length = 0; reject(Object.assign(new Error('too large'), { tooLarge: true })); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validate(body) {
  const details = [];
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = body.password;
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    details.push({ field: 'email', message: '올바른 이메일 형식으로 입력하세요. 예: user1@example.com' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    details.push({ field: 'password', message: '비밀번호는 8자 이상으로 입력하세요.' });
  } else if (password.length > 128) {
    details.push({ field: 'password', message: '비밀번호는 128자 이하로 입력하세요.' });
  }
  return { details, email: email.toLowerCase(), password };
}

const TAKEN = ['이미 가입된 이메일입니다. 다른 이메일을 쓰거나 로그인하세요.', [{ field: 'email', message: '이미 가입된 이메일입니다.' }]];

function createServer(db = openDb(), { logger = console } = {}) {
  return http.createServer(async (req, res) => {
    const traceId = crypto.randomUUID();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/signup') {
        if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'POST 로 요청하세요.', [], traceId);
        let body;
        try {
          body = JSON.parse(await readBody(req));
          if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
        } catch (e) {
          if (e.tooLarge) return sendError(res, 413, 'PAYLOAD_TOO_LARGE', '요청이 너무 큽니다. 8KB 이하로 보내세요.', [], traceId);
          return sendError(res, 400, 'INVALID_JSON', '요청 본문이 JSON 객체가 아닙니다. 형식을 확인하세요.', [], traceId);
        }
        const { details, email, password } = validate(body);
        if (details.length) return sendError(res, 400, 'VALIDATION_FAILED', '입력값을 확인하세요.', details, traceId);
        if (findUserByEmail(db, email)) return sendError(res, 409, 'EMAIL_TAKEN', TAKEN[0], TAKEN[1], traceId);
        let id;
        try {
          id = addUser(db, { email, passwordHash: hashPassword(password) });
        } catch (e) {
          if (/UNIQUE/i.test(String(e.message))) return sendError(res, 409, 'EMAIL_TAKEN', TAKEN[0], TAKEN[1], traceId);
          throw e;
        }
        return sendJson(res, 201, { id, email });
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/signup.html')) {
        return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE));
      }
      return sendError(res, 404, 'NOT_FOUND', '찾을 수 없는 주소입니다.', [], traceId);
    } catch (e) {
      logger.error(`[${traceId}] ${e.name}: ${e.message}`);
      return sendError(res, 500, 'INTERNAL', '서버 오류가 발생했습니다. 잠시 후 다시 시도하고, 계속되면 추적 번호를 알려 주세요.', [], traceId);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer(openDb(process.env.DB_PATH || 'app.db')).listen(port, '127.0.0.1', () => console.log(`listening on ${port}`));
}

module.exports = { createServer };
