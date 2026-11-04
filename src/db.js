'use strict';
const { DatabaseSync } = require('node:sqlite');

function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
}

function addUser(db, { email, passwordHash }) {
  const r = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash);
  return Number(r.lastInsertRowid);
}

function findUserByEmail(db, email) {
  return db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(email);
}

module.exports = { openDb, migrate, addUser, findUserByEmail };
