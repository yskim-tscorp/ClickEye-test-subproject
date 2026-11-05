'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb, migrate } = require('../src/db');
const { createServer } = require('../src/server');
const { verifyPassword } = require('../src/auth');

const PW = 'test-pw-0001-unique';
let db, server, base;
const logs = [];

before(async () => {
  db = openDb(':memory:');
  migrate(db);
  migrate(db); // 멱등
  server = createServer(db, { logger: { error: (m) => logs.push(m), log: (m) => logs.push(m) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const post = (body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/api/signup`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('가입 성공 201, 응답에 비밀번호·해시 없음, 평문 미저장', async () => {
  const res = await post({ email: 'user1@example.test', password: PW });
  assert.equal(res.status, 201);
  const text = await res.text();
  assert.ok(!text.includes(PW) && !text.includes('password'));
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('user1@example.test');
  assert.ok(row.created_at.endsWith('Z'));
  for (const v of Object.values(row)) assert.ok(!String(v).includes(PW));
  assert.match(row.password_hash, /^scrypt\$\d+\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword(PW, row.password_hash), true);
  assert.equal(await verifyPassword('wrong-password', row.password_hash), false);
  assert.ok(!logs.join('\n').includes(PW));
});

test('중복 이메일은 409 와 code·message (대소문자만 달라도)', async () => {
  const res = await post({ email: 'USER1@Example.test', password: PW });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'EMAIL_TAKEN');
  assert.ok(body.message);
  assert.equal(body.details[0].field, 'email');
});

test('검증 실패 400: 필드별 details, 둘 다 틀리면 2개', async () => {
  const res = await post({ email: 'not-an-email', password: 'short' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'VALIDATION_FAILED');
  assert.deepEqual(body.details.map((d) => d.field).sort(), ['email', 'password']);
  assert.ok(!JSON.stringify(body).includes('short'));
});

test('비밀번호 경계값: 7자 400, 8자 201, 128자 201, 129자 400', async () => {
  const cases = [[7, 400], [8, 201], [128, 201], [129, 400]];
  for (const [n, status] of cases) {
    const res = await post({ email: `len${n}@example.test`, password: 'a'.repeat(n) });
    assert.equal(res.status, status, `length ${n}`);
  }
});

test('필드 누락·타입 오류는 400', async () => {
  assert.equal((await post({ email: 'a1@example.test' })).status, 400);
  assert.equal((await post({ email: 'a2@example.test', password: 12345678 })).status, 400);
});

test('잘못된 JSON 400, 큰 본문 413, 잘못된 Content-Type 415, 서버는 계속 응답', async () => {
  const bad = await post('{not json');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'INVALID_JSON');
  const big = await post(JSON.stringify({ email: 'big@example.test', password: 'x'.repeat(20000) }));
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, 'PAYLOAD_TOO_LARGE');
  const mt = await post('x', { 'Content-Type': 'text/plain' });
  assert.equal(mt.status, 415);
  assert.equal((await post({ email: 'after@example.test', password: PW })).status, 201);
});

test('가입 폼과 알 수 없는 경로', async () => {
  for (const p of ['/signup', '/signup.html']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  }
  const nf = await fetch(base + '/nope');
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).code, 'NOT_FOUND');
});

test('동시 같은 이메일 가입은 하나만 201, 나머지 409', async () => {
  const rs = await Promise.all(
    [1, 2, 3].map(() => post({ email: 'race@example.test', password: PW })),
  );
  const statuses = rs.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409]);
});

test('로그에 비밀번호가 없다', () => {
  assert.ok(!logs.join('\n').includes(PW));
});
