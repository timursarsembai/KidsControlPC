import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword, verifyPassword } from './password.js'

test('accepts the correct password', async () => {
  const hash = await hashPassword('правильный-пароль-123')
  assert.equal(await verifyPassword('правильный-пароль-123', hash), true)
})

test('rejects a wrong password', async () => {
  const hash = await hashPassword('правильный-пароль-123')
  assert.equal(await verifyPassword('правильный-пароль-124', hash), false)
})

test('salts every hash separately', async () => {
  const a = await hashPassword('одинаковый')
  const b = await hashPassword('одинаковый')
  assert.notEqual(a, b, 'two hashes of the same password must differ')
  assert.equal(await verifyPassword('одинаковый', a), true)
  assert.equal(await verifyPassword('одинаковый', b), true)
})

test('stores the parameters so they can be raised later', async () => {
  const hash = await hashPassword('пароль-для-разбора')
  const [algo, n, r, p] = hash.split('$')
  assert.equal(algo, 'scrypt')
  assert.equal(Number(n), 16384)
  assert.equal(Number(r), 8)
  assert.equal(Number(p), 1)
})

// An imported account has no password until its owner sets one. That must fail
// the login like a wrong password, not throw and turn into a 500.
test('returns false instead of throwing on a missing or broken hash', async () => {
  assert.equal(await verifyPassword('любой', null), false)
  assert.equal(await verifyPassword('любой', ''), false)
  assert.equal(await verifyPassword('любой', 'not-a-hash'), false)
  assert.equal(await verifyPassword('любой', 'scrypt$1$2$3'), false)
  assert.equal(await verifyPassword('любой', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA=='), false)
  assert.equal(await verifyPassword(null, 'scrypt$16384$8$1$c2FsdA==$aGFzaA=='), false)
})

// A hash string is attacker-controlled the moment a database is restored from
// an untrusted dump; wild parameters must be refused, not honoured.
test('refuses absurd scrypt parameters instead of exhausting memory', async () => {
  const absurd = ['scrypt', 2 ** 22, 64, 1, 'c2FsdA==', 'aGFzaA=='].join('$')
  assert.equal(await verifyPassword('любой', absurd), false)
})

test('rejects passwords longer than the cap', async () => {
  await assert.rejects(() => hashPassword('x'.repeat(201)))
  const hash = await hashPassword('нормальный-пароль')
  assert.equal(await verifyPassword('x'.repeat(201), hash), false)
})

// Unicode normalisation: the same characters typed on different platforms can
// arrive as different byte sequences. Without NFKC the parent sets a password
// on Windows and cannot log in from a phone.
test('normalises unicode before hashing', async () => {
  const composed = 'парольé'          // é as one code point
  const decomposed = 'парольé'  // e + combining acute
  const hash = await hashPassword(composed)
  assert.equal(await verifyPassword(decomposed, hash), true)
})
