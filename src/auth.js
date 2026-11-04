'use strict';
const crypto = require('node:crypto');

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

// 저장 형식: scrypt$N$r$p$saltHex$hashHex
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('hex'), hash.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
  const [alg, N, r, p, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
