'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { openDb, findUserByEmail } = require('../src/db');
const { createServer } = require('../src/server');
const { verifyPassword } = require('../src/auth');

let server, db, base;
const logs = [];
before(async () => {
  db = openDb(':memory:');
  server = createServer(db, { logger: { error: (m) => logs.push(m) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));

const post = (body, raw) => fetch(`${base}/api/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: raw ?? JSON.stringify(body)
});

test('가입 성공: 201, 해시만 저장, 로그에 평문 없음', async () => {
  const res = await post({ email: 'User1@example.com', password: 'placeholder-pw-1' });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.deepStrictEqual(Object.keys(body).sort(), ['email', 'id']);
  const row = findUserByEmail(db, 'user1@example.com');
  assert.ok(row);
  assert.ok(!row.password_hash.includes('placeholder-pw-1'));
  assert.ok(verifyPassword('placeholder-pw-1', row.password_hash));
  assert.ok(!verifyPassword('wrong-password', row.password_hash));
  assert.ok(!logs.join('\n').includes('placeholder-pw-1'));
});

test('중복 이메일(대소문자 달라도): 409 + code·message', async () => {
  const res = await post({ email: 'USER1@example.com', password: 'another-pass1' });
  assert.strictEqual(res.status, 409);
  const body = await res.json();
  assert.strictEqual(body.code, 'EMAIL_TAKEN');
  assert.ok(body.message);
  assert.ok(Array.isArray(body.details));
});

test('동시 가입: 한 건만 201, 나머지 409, 500 없음', async () => {
  const rs = await Promise.all([1, 2, 3].map(() => post({ email: 'race@example.com', password: 'placeholder-pw-2' })));
  const codes = rs.map((r) => r.status).sort();
  assert.deepStrictEqual(codes, [201, 409, 409]);
});

test('검증 실패: 400 + 필드별 details', async () => {
  const res = await post({ email: 'not-an-email', password: 'short' });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.code, 'VALIDATION_FAILED');
  assert.deepStrictEqual(body.details.map((d) => d.field).sort(), ['email', 'password']);
  assert.ok(body.trace_id);
});

test('비밀번호 7자 400, 8자 201, 129자 400', async () => {
  assert.strictEqual((await post({ email: 'a7@example.com', password: '1234567' })).status, 400);
  assert.strictEqual((await post({ email: 'a8@example.com', password: '12345678' })).status, 201);
  assert.strictEqual((await post({ email: 'a9@example.com', password: 'x'.repeat(129) })).status, 400);
});

test('잘못된 JSON 400, 큰 본문 413, GET 405', async () => {
  const bad = await post(null, '{bad');
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await bad.json()).code, 'INVALID_JSON');
  const big = await post(null, JSON.stringify({ email: 'b@example.com', password: 'x'.repeat(20000) }));
  assert.strictEqual(big.status, 413);
  const get = await fetch(`${base}/api/signup`);
  assert.strictEqual(get.status, 405);
});

test('가입 폼 서빙(라벨·alert), 알 수 없는 경로 404', async () => {
  const page = await fetch(`${base}/`);
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /<label for="email">/);
  assert.match(html, /role="alert"/);
  const nf = await fetch(`${base}/../package.json`);
  assert.strictEqual(nf.status, 404);
  assert.strictEqual((await nf.json()).code, 'NOT_FOUND');
});
