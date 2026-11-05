'use strict';
const crypto = require('node:crypto');

const PARAMS = { N: 32768, r: 8, p: 1 };
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

// 저장 형식: scrypt$N$r$p$saltHex$hashHex (매개변수를 함께 저장해 나중에 올릴 수 있다)
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('hex'), key.toString('hex')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Object.values(params).every(Number.isInteger)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  let key;
  try {
    key = await scrypt(password, Buffer.from(saltHex, 'hex'), params);
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(key, expected);
}

module.exports = { hashPassword, verifyPassword };
