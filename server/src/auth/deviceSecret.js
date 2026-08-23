// The credential a paired agent keeps on the child's PC (pairing.json) and
// trades for a short-lived access token.
//
// Hashed with SHA-256 rather than scrypt, for the same reason refresh tokens
// are: it is 32 bytes from the system CSPRNG, so there is no dictionary to run
// against it, and the hash has to be looked up on every token request.
//
// What this secret must NEVER do is decide permissions. It rotates on every
// re-pairing, and in the Firebase version the right to read a device's own
// commands was keyed to it — so rotating it stranded rows that no longer
// matched. Here the secret only proves identity once; everything after that is
// authorised by device_id inside a signed token.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function generateDeviceSecret() {
  return randomBytes(32).toString('base64url')
}

export function hashDeviceSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex')
}

export function deviceSecretMatches(candidate, storedHash) {
  if (typeof candidate !== 'string' || typeof storedHash !== 'string') return false
  if (candidate.length === 0 || storedHash.length === 0) return false

  const a = Buffer.from(hashDeviceSecret(candidate), 'utf8')
  const b = Buffer.from(storedHash, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
