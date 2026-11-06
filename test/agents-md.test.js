// AGENTS.md 가 AUT-8 수용 기준을 지키는지 확인하는 얕은 검사다(핵심 토큰 존재 위주).
// 의미의 정확성은 PR 검토에서 본다. Node 18 이상.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'AGENTS.md');
assert.ok(fs.existsSync(file), '루트에 AGENTS.md 가 없다');
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');
const lineWith = (token) => lines.find((l) => l.includes(token)) || '';

test('AGENTS.md 는 비어 있지 않다', () => {
  assert.ok(text.trim().length > 0);
});

test('불문율 3개가 적혀 있다', () => {
  assert.match(lineWith('C-05'), /한 곳/);
  assert.match(lineWith('api/openapi.yaml'), /정본/);
  assert.match(lineWith('Clock'), /Clock/);
});

test('함정 4개가 적혀 있다', () => {
  const log = lineWith('로그와 오류 응답');
  for (const w of ['비밀번호', '이름', '회사 메일', 'DB 접속 문자열']) {
    assert.ok(log.includes(w), `금지 항목 누락: ${w}`);
  }
  assert.match(lineWith('${TEST_DATABASE_URL}'), /PostgreSQL/);
  assert.match(lineWith('두 곳뿐'), /회사 계정과 시계/);
  assert.match(lineWith('스파이크'), /머지 대상이 아니다/);
});

test('정식 용어를 쓰고 피할 말은 쓰지 않는다', () => {
  for (const w of ['도서', '권', '대여', '반납', '내 대여 현황', '요청 식별자']) {
    assert.ok(text.includes(w), `정식 용어 누락: ${w}`);
  }
  // 일반 낱말 '책임'·'반환값' 은 허용 목록으로 먼저 지운 뒤 검사한다.
  const cleaned = text.replace(/책임|반환값/g, '');
  for (const w of ['책', '대출', '반환']) {
    assert.ok(!cleaned.includes(w), `피할 말 사용: ${w}`);
  }
});

test('자리표시자만 있고 실제 비밀값·번호는 없다', () => {
  assert.ok(text.includes('${COMPANY_AUTH_CLIENT_SECRET}'));
  assert.ok(text.includes('<IT 지원 내선>'));
  assert.doesNotMatch(text, /\d{2,4}-\d{3,4}-\d{4}/);
  assert.doesNotMatch(text, /\w+:\/\/[^\s:@]+:[^\s@]+@/);
  assert.doesNotMatch(text, /[A-Za-z0-9_\-]{40,}/);
});
