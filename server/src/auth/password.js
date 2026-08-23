// Password hashing on top of node:crypto scrypt.
//
// Not argon2/bcrypt: both are native modules, and a native build step on a box
// with no Node and ~2.5 GB of free RAM is a dependency that will one day fail
// to compile during an unattended rebuild. scrypt is memory-hard, ships with
// Node, and is a sanctioned choice for password storage.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// 128 * N * r = 16 MB per hash. Node's default maxmem is 32 MB, so this fits
// without raising it; raising N later is why the parameters are stored inside
// the hash string rather than assumed at verify time.
const N = 16384
const R = 8
const P = 1
const KEY_LEN = 64
const SALT_LEN = 16

// A password long enough to make scrypt slow is a denial of service, not a
// stronger secret — the route schema caps it too, this is the backstop.
const MAX_PASSWORD_LEN = 200

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password must be a non-empty string')
  }
  if (password.length > MAX_PASSWORD_LEN) {
    throw new Error(`password must be at most ${MAX_PASSWORD_LEN} characters`)
  }

  const salt = randomBytes(SALT_LEN)
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LEN, { N, r: R, p: P })
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$')
}

// Never throws on a malformed or missing hash — an account row with a null
// password (created by the Firestore import before its owner sets one) must
// fail the login like a wrong password, not 500 the whole request.
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false
  if (password.length === 0 || password.length > MAX_PASSWORD_LEN) return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let salt, expected
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let derived
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      // A hash string claiming huge parameters must not be able to exhaust
      // memory: reject it instead of trying to honour it.
      maxmem: 64 * 1024 * 1024
    })
  } catch {
    return false
  }

  return timingSafeEqual(derived, expected)
}

// Login must take the same time whether or not the email exists, otherwise the
// response time tells an attacker which addresses are registered. Verifying
// against this hash costs exactly what a real verification costs.
let dummyHashPromise = null
export async function verifyAgainstDummy(password) {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(32).toString('hex'))
  }
  return verifyPassword(password, await dummyHashPromise)
}
