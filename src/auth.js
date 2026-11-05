import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password, salt, n, r, p, keylen) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// 형식: scrypt$N=16384,r=8,p=1$<salt hex>$<hash hex>
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, params, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !hashHex) return false;
    const m = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(params);
    if (!m) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await derive(password, Buffer.from(saltHex, 'hex'), Number(m[1]), Number(m[2]), Number(m[3]), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
