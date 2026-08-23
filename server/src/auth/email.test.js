import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksLikeEmail, normalizeEmail } from './email.js'

test('trims and lowercases', () => {
  assert.equal(normalizeEmail('  Parent@Example.KZ '), 'parent@example.kz')
})

test('survives non-strings', () => {
  assert.equal(normalizeEmail(null), '')
  assert.equal(normalizeEmail(undefined), '')
  assert.equal(normalizeEmail(42), '')
})

// Two addresses the parent considers different must stay different. Stripping
// dots or +tags would silently merge them.
test('keeps dots and plus tags', () => {
  assert.equal(normalizeEmail('a.b+kids@gmail.com'), 'a.b+kids@gmail.com')
})

test('accepts ordinary addresses', () => {
  for (const value of ['parent@example.kz', 'a.b+kids@gmail.com', 'x@y.co.uk']) {
    assert.equal(looksLikeEmail(value), true, value)
  }
})

test('rejects obvious nonsense', () => {
  for (const value of ['', 'parent', 'parent@', '@example.kz', 'a@b', 'a b@c.kz', 'a@b..kz']) {
    assert.equal(looksLikeEmail(value), false, JSON.stringify(value))
  }
})

test('rejects addresses past the length limit', () => {
  assert.equal(looksLikeEmail('a'.repeat(250) + '@example.kz'), false)
})
