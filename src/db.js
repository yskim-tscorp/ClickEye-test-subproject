'use strict';
const { DatabaseSync } = require('node:sqlite');

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

// 멱등. 최초 스키마(user_version 1). 되돌림: DROP TABLE users.
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (email = lower(email)),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    PRAGMA user_version = 1;
  `);
}

// UNIQUE 위반을 잡아 {ok:false, reason:'duplicate'} 로 돌려준다(선조회 없음 — 경쟁 상태 방지).
function addUser(db, { email, passwordHash }) {
  try {
    const r = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(normalizeEmail(email), passwordHash);
    return { ok: true, id: Number(r.lastInsertRowid) };
  } catch (err) {
    if (err && /UNIQUE constraint failed/.test(err.message)) {
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  }
}

function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
}

module.exports = { openDb, migrate, addUser, findUserByEmail, normalizeEmail };
