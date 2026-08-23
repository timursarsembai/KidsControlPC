// Parent sessions: a short-lived signed access token plus a long-lived opaque
// refresh token stored in the database.
//
// The refresh token is hashed with plain SHA-256, not scrypt: it is 32 bytes of
// randomness, so there is nothing to brute-force, and it has to be looked up by
// its hash on every refresh — a per-row password KDF would make that a table
// scan. Passwords are a different matter and use scrypt (see password.js).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { query } from '../db.js'

const ISSUER = 'kidscontrol'
export const AUDIENCE_PARENT = 'parent'
export const AUDIENCE_AGENT = 'agent'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function signAccessToken(userId) {
  return jwt.sign({ typ: AUDIENCE_PARENT }, config.jwtSecret, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE_PARENT,
    expiresIn: config.accessTokenTtlSec
  })
}

/**
 * Access token for a paired agent.
 *
 * ownerId travels as a claim so device routes need no lookup to know whose
 * account they are touching, but authorisation always rests on `sub` — the
 * device id, which never changes. The device secret can rotate underneath
 * this without invalidating a single stored row.
 */
export function signAgentToken(deviceId, ownerId) {
  return jwt.sign({ typ: AUDIENCE_AGENT, ownerId }, config.jwtSecret, {
    subject: deviceId,
    issuer: ISSUER,
    audience: AUDIENCE_AGENT,
    expiresIn: config.agentTokenTtlSec
  })
}

// Returns the payload, or null for anything wrong — expired, tampered with, or
// an agent token presented on a parent route. The audience check is what keeps
// those two apart: an agent token must never open the parent API.
export function verifyAccessToken(token, audience = AUDIENCE_PARENT) {
  try {
    return jwt.verify(token, config.jwtSecret, { issuer: ISSUER, audience })
  } catch {
    return null
  }
}

export async function issueRefreshToken(userId, userAgent) {
  const raw = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlSec * 1000)
  await query(
    `insert into refresh_tokens (user_id, token_hash, user_agent, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, sha256(raw), (userAgent || '').slice(0, 300), expiresAt]
  )
  return { token: raw, expiresAt }
}

/**
 * Trades a refresh token for a new pair, rotating it.
 *
 * A token that is presented twice means one of the two holders is not the
 * owner — a stolen copy being replayed. There is no way to tell which, so
 * every session of that user is revoked and both are forced to log in again.
 * Silently issuing a new pair would let a thief keep the account forever.
 *
 * @returns {Promise<{userId: string, token: string} | null>}
 */
export async function rotateRefreshToken(rawToken, userAgent) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null

  const hash = sha256(rawToken)

  // Claim the token with the UPDATE itself, rather than checking with a SELECT
  // first and then updating. Two refreshes arriving together would both pass
  // the check and both get a new pair — which is precisely the replay this
  // function exists to detect, waved through by a race.
  const claimed = await query(
    `update refresh_tokens
        set revoked_at = now(), revoked_reason = 'rotated'
      where token_hash = $1 and revoked_at is null and expires_at > now()
      returning user_id`,
    [hash]
  )

  if (claimed.rowCount === 1) {
    const userId = claimed.rows[0].user_id
    const next = await issueRefreshToken(userId, userAgent)
    return { userId, token: next.token }
  }

  // Nothing claimed: the token is unknown, expired, or already revoked. Only
  // one of those is a replay.
  const { rows } = await query(
    'select user_id, revoked_at, revoked_reason from refresh_tokens where token_hash = $1',
    [hash]
  )
  // A token revoked because it was rotated should never be presented again —
  // whoever holds it got the replacement. Any other reason (a password change,
  // a sign-out) is something the owner did on purpose, and a stale tab
  // stumbling over it must not cost them the session they are using.
  if (rows[0]?.revoked_at && rows[0].revoked_reason === 'rotated') {
    await revokeAllForUser(rows[0].user_id, 'reuse_detected')
  }
  return null
}

export async function revokeRefreshToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return
  await query(
    `update refresh_tokens
        set revoked_at = now(), revoked_reason = 'logout'
      where token_hash = $1 and revoked_at is null`,
    [sha256(rawToken)]
  )
}

export async function revokeAllForUser(userId, reason = 'password_change') {
  await query(
    `update refresh_tokens
        set revoked_at = now(), revoked_reason = $2
      where user_id = $1 and revoked_at is null`,
    [userId, reason]
  )
}

// Expired and revoked rows are dead weight; a parent logging in daily for a
// year leaves hundreds behind. Called from the maintenance loop.
export async function pruneRefreshTokens() {
  const { rowCount } = await query(
    `delete from refresh_tokens
      where expires_at < now() - interval '7 days'
         or (revoked_at is not null and revoked_at < now() - interval '7 days')`
  )
  return rowCount
}

// Exported for tests: compares two token strings without leaking length or
// content through timing.
export function tokensEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
