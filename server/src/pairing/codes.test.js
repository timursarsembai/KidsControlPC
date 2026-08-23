import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODE_ALPHABET, CODE_LENGTH, generatePairingCode, normalizePairingCode } from './codes.js'

test('generates codes of the agreed length and alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const code = generatePairingCode()
    assert.equal(code.length, CODE_LENGTH)
    for (const ch of code) {
      assert.ok(CODE_ALPHABET.includes(ch), `unexpected character ${ch} in ${code}`)
    }
  }
})

// The code gets read off one screen and typed on another. Characters that look
// alike in a sans-serif font turn into support calls.
test('never emits look-alike characters', () => {
  for (const ch of 'IO01') {
    assert.equal(CODE_ALPHABET.includes(ch), false, `${ch} must not be in the alphabet`)
  }
})

test('does not produce the same code twice in a row', () => {
  const seen = new Set()
  for (let i = 0; i < 500; i++) seen.add(generatePairingCode())
  // 32^6 possibilities: 500 draws colliding would mean the generator is broken.
  assert.ok(seen.size > 495, `too many repeats: ${seen.size} unique out of 500`)
})

test('accepts what a person actually types', () => {
  assert.equal(normalizePairingCode('abc234'), 'ABC234')
  assert.equal(normalizePairingCode('  ABC234  '), 'ABC234')
  assert.equal(normalizePairingCode('ABC-234'), 'ABC234')
  assert.equal(normalizePairingCode('a b c 2 3 4'), 'ABC234')
})

test('rejects anything that cannot be a code', () => {
  for (const value of ['', 'ABC23', 'ABC2345', 'ABC23!', 'ABCI23', 'ABC023', null, undefined, 42]) {
    assert.equal(normalizePairingCode(value), '', JSON.stringify(value))
  }
})
