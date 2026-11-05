import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate, findUserByEmail } from '../src/db.js';
import { createServer } from '../src/server.js';
import { hashPassword, verifyPassword } from '../src/auth.js';

const PW = 'test-password-0001';
let db, server, base, logs;

before(async () => {
  db = openDb(':memory:');
  migrate(db);
  logs = [];
  server = createServer(db, { log: (l) => logs.push(l) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const post = (body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${base}/api/signup`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

function assertErrorShape(json, code) {
  assert.deepEqual(Object.keys(json).sort(), ['code', 'details', 'message', 'trace_id']);
  assert.equal(json.code, code);
  assert.ok(json.message);
  assert.ok(json.trace_id);
  assert.ok(Array.isArray(json.details));
}

test('가입 성공 201, 해시는 응답에 없고 DB 에 평문 없음', async () => {
  const res = await post({ email: 'user1@example.com', password: PW });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.email, 'user1@example.com');
  assert.equal(JSON.stringify(json).includes('hash'), false);
  const row = findUserByEmail(db, 'user1@example.com');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.equal(row.password_hash.includes(PW), false);
  assert.equal(await verifyPassword(PW, row.password_hash), true);
  assert.equal(await verifyPassword('wrong-password', row.password_hash), false);
});

test('같은 비밀번호도 솔트 때문에 해시가 다르다', async () => {
  assert.notEqual(await hashPassword(PW), await hashPassword(PW));
});

test('중복 이메일 409 (대소문자만 달라도)', async () => {
  assert.equal((await post({ email: 'dup@example.com', password: PW })).status, 201);
  for (const email of ['dup@example.com', 'DUP@Example.com']) {
    const res = await post({ email, password: PW });
    assert.equal(res.status, 409);
    assertErrorShape(await res.json(), 'EMAIL_ALREADY_EXISTS');
  }
});

test('동시에 같은 이메일 2건: 201 하나, 409 하나', async () => {
  const rs = await Promise.all([1, 2].map(() => post({ email: 'race@example.com', password: PW })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
});

test('검증 실패 400 과 필드별 details', async () => {
  const res = await post({ email: 'not-an-email', password: 'short' });
  assert.equal(res.status, 400);
  const json = await res.json();
  assertErrorShape(json, 'VALIDATION_FAILED');
  assert.deepEqual(json.details.map((d) => d.field).sort(), ['email', 'password']);
  assert.equal(JSON.stringify(json).includes('short'), false);
});

test('비밀번호 길이 경계 7/8/128/129', async () => {
  const at = async (n, i) => (await post({ email: `len${i}@example.com`, password: 'a'.repeat(n) })).status;
  assert.equal(await at(7, 7), 400);
  assert.equal(await at(8, 8), 201);
  assert.equal(await at(128, 128), 201);
  assert.equal(await at(129, 129), 400);
});

test('필드 누락·타입 오류는 400', async () => {
  for (const body of [{}, { email: 'a@example.com' }, { email: ['a@example.com'], password: PW }, { email: 'a@example.com', password: 12345678 }, []]) {
    const res = await post(body);
    assert.equal(res.status, 400);
    assertErrorShape(await res.json(), 'VALIDATION_FAILED');
  }
});

test('깨진 JSON 400, 잘못된 Content-Type 415, 큰 본문 413', async () => {
  let res = await post('{oops');
  assert.equal(res.status, 400);
  assertErrorShape(await res.json(), 'INVALID_JSON');
  res = await post('{}', { 'content-type': 'text/plain' });
  assert.equal(res.status, 415);
  assertErrorShape(await res.json(), 'UNSUPPORTED_MEDIA_TYPE');
  res = await post({ email: 'big@example.com', password: 'x'.repeat(20000) });
  assert.equal(res.status, 413);
  assertErrorShape(await res.json(), 'PAYLOAD_TOO_LARGE');
});

test('404 / 405 도 같은 오류 모양', async () => {
  let res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assertErrorShape(await res.json(), 'NOT_FOUND');
  res = await fetch(`${base}/api/signup`);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assertErrorShape(await res.json(), 'METHOD_NOT_ALLOWED');
});

test('GET /signup.html 은 200 HTML', async () => {
  const res = await fetch(`${base}/signup.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<label for="email">/);
});

test('500 은 상세를 숨기고 같은 모양', async () => {
  const badDb = openDb(':memory:'); // 마이그레이션 안 함 → users 테이블 없음
  const logged = [];
  const s = createServer(badDb, { log: (l) => logged.push(l) });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e@example.com', password: PW }),
    });
    assert.equal(res.status, 500);
    const text = await res.text();
    assertErrorShape(JSON.parse(text), 'INTERNAL');
    assert.equal(/users|SQL|sqlite|\.js/i.test(text), false);
    assert.equal(logged.join('\n').includes(PW), false);
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test('로그에 비밀번호·이메일·본문이 없다', () => {
  const all = logs.join('\n');
  assert.ok(logs.length > 0);
  assert.equal(all.includes(PW), false);
  assert.equal(all.includes('@example.com'), false);
});
