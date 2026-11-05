import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from './auth.js';
import { addUser, DuplicateEmailError, normalizeEmail } from './db.js';

const MAX_BODY = 10 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_DIR = new URL('../public/', import.meta.url);
const STATIC = {
  '/signup.html': ['signup.html', 'text/html; charset=utf-8'],
  '/signup.js': ['signup.js', 'text/javascript; charset=utf-8'],
};

// 오류 코드표 — 오류 응답 모양은 sendError 한 곳에서만 만든다.
export const ERRORS = {
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  EMAIL_ALREADY_EXISTS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

function sendError(res, traceId, code, message, details = [], extra = {}) {
  sendJson(res, ERRORS[code], { code, message, details, trace_id: traceId }, extra);
}

export function validateSignup(body) {
  const details = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: '요청 본문은 JSON 객체여야 합니다.' }];
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email) details.push({ field: 'email', message: '이메일을 입력하세요.' });
  else if (email.length > 254 || !EMAIL_RE.test(email)) details.push({ field: 'email', message: '올바른 이메일 형식이 아닙니다.' });
  const pw = body.password;
  if (typeof pw !== 'string' || pw.length === 0) details.push({ field: 'password', message: '비밀번호를 입력하세요.' });
  else if (pw.length < 8) details.push({ field: 'password', message: '비밀번호는 8자 이상이어야 합니다.' });
  else if (pw.length > 128) details.push({ field: 'password', message: '비밀번호는 128자 이하여야 합니다.' });
  return details;
}

class BodyTooLarge extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BodyTooLarge());
        req.pause();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function signup(req, res, traceId, ctx) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return sendError(res, traceId, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 은 application/json 이어야 합니다.');
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      return sendError(res, traceId, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.', [], { connection: 'close' });
    }
    if (err instanceof SyntaxError) return sendError(res, traceId, 'INVALID_JSON', '요청 본문이 올바른 JSON 이 아닙니다.');
    throw err;
  }
  const details = validateSignup(body);
  if (details.length) return sendError(res, traceId, 'VALIDATION_FAILED', '입력값을 확인하세요.', details);
  const passwordHash = await hashPassword(body.password);
  try {
    const user = addUser(ctx.db, { email: normalizeEmail(body.email), passwordHash });
    sendJson(res, 201, user);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return sendError(res, traceId, 'EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.');
    }
    throw err;
  }
}

// 로그에는 메서드·경로·상태·trace_id 만 남긴다(본문·쿼리·이메일·비밀번호 금지).
export function createServer(db, { log = (line) => console.log(line) } = {}) {
  return http.createServer(async (req, res) => {
    const traceId = randomUUID();
    const path = (req.url ?? '').split('?')[0];
    res.on('finish', () => log(`${req.method} ${path} ${res.statusCode} trace_id=${traceId}`));
    try {
      if (path === '/api/signup') {
        if (req.method !== 'POST') {
          return sendError(res, traceId, 'METHOD_NOT_ALLOWED', '허용되지 않는 메서드입니다.', [], { allow: 'POST' });
        }
        return await signup(req, res, traceId, { db });
      }
      if (req.method === 'GET' && Object.hasOwn(STATIC, path)) {
        const [file, type] = STATIC[path];
        const data = await readFile(new URL(file, PUBLIC_DIR));
        res.writeHead(200, {
          'content-type': type,
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
          ...SECURITY_HEADERS,
        });
        return res.end(data);
      }
      sendError(res, traceId, 'NOT_FOUND', '찾을 수 없습니다.');
    } catch (err) {
      log(`error trace_id=${traceId} ${err?.name ?? 'Error'}`);
      if (!res.headersSent) sendError(res, traceId, 'INTERNAL', '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.');
      else res.end();
    }
  });
}
