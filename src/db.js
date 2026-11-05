import { DatabaseSync } from 'node:sqlite';

export class DuplicateEmailError extends Error {
  constructor() {
    super('email already exists');
    this.name = 'DuplicateEmailError';
  }
}

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (email = lower(email)),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

// 중복 판정은 조회 후 삽입이 아니라 UNIQUE 위반으로 한다(동시 가입 경합 대비).
export function addUser(db, { email, passwordHash }) {
  const normalized = normalizeEmail(email);
  try {
    const result = db
      .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
      .run(normalized, passwordHash, new Date().toISOString());
    return { id: Number(result.lastInsertRowid), email: normalized };
  } catch (err) {
    if (err?.errcode === 2067 || err?.errcode === 1555 || /UNIQUE constraint failed/.test(err?.message ?? '')) {
      throw new DuplicateEmailError();
    }
    throw err;
  }
}

export function findUserByEmail(db, email) {
  return db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(normalizeEmail(email));
}
