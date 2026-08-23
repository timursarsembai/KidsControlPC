// Password recovery and address confirmation — the two things that need mail.

import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { query } from '../db.js'
import { badRequest, unauthorized } from '../errors.js'
import { looksLikeEmail, normalizeEmail } from '../auth/email.js'
import { hashPassword } from '../auth/password.js'
import { requireParent } from '../auth/guard.js'
import { issueRefreshToken, revokeAllForUser, signAccessToken } from '../auth/tokens.js'
import { mailEnabled, sendMail } from '../mail/mailer.js'
import { emailVerificationEmail, passwordResetEmail } from '../mail/templates.js'

const PURPOSE_RESET = 'password_reset'
const PURPOSE_VERIFY = 'email_verification'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Creates a single-use token and returns the raw value for the link.
 *
 * Replaces any live token for the same purpose: asking again should not leave
 * a pile of working keys in a mailbox.
 */
async function issueEmailToken(userId, purpose, email, ttlSec) {
  const raw = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlSec * 1000)

  await query(
    `insert into email_tokens (user_id, purpose, token_hash, email, expires_at)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, purpose) where used_at is null do update
       set token_hash = excluded.token_hash,
           email = excluded.email,
           expires_at = excluded.expires_at,
           created_at = now()`,
    [userId, purpose, sha256(raw), email, expiresAt]
  )
  return raw
}

/**
 * Spends a token. Returns the user it belongs to, or null.
 *
 * Claimed with the UPDATE itself so a link cannot be used twice by two clicks
 * arriving together, and checked against the account's current address: a link
 * mailed to an old address must not open an account that has since moved.
 */
async function claimEmailToken(rawToken, purpose) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null

  const { rows } = await query(
    `update email_tokens t
        set used_at = now()
       from users u
      where t.token_hash = $1
        and t.purpose = $2
        and t.used_at is null
        and t.expires_at > now()
        and u.id = t.user_id
        and lower(u.email) = lower(t.email)
      returning t.user_id, u.email`,
    [sha256(rawToken), purpose]
  )
  return rows[0] ?? null
}

export default async function emailAuthRoutes(app) {
  // Whether the panel should offer recovery at all. Showing a form that
  // silently does nothing is worse than not showing it.
  app.get('/auth/capabilities', async () => ({
    passwordReset: mailEnabled,
    emailVerification: mailEnabled
  }))

  /**
   * Asks for a recovery link.
   *
   * Always answers the same, whatever happened. Anything else — a different
   * status, a different message, a noticeably different response time — turns
   * this into a way to ask "does this family have an account here", and these
   * are accounts about children.
   */
  app.post('/auth/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', minLength: 3, maxLength: 254 } },
        additionalProperties: false
      }
    },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  }, async (request) => {
    const email = normalizeEmail(request.body.email)

    if (looksLikeEmail(email)) {
      const { rows } = await query('select id, email from users where lower(email) = $1', [email])
      if (rows[0]) {
        const token = await issueEmailToken(
          rows[0].id, PURPOSE_RESET, rows[0].email, config.passwordResetTtlSec
        )
        const url = `${config.publicOrigin}/reset-password?token=${token}`
        // Not awaited on purpose. Talking to an SMTP server takes hundreds of
        // milliseconds, and waiting for it would make the answer measurably
        // slower for addresses that exist — which is the same disclosure the
        // identical response body is there to prevent.
        sendMail(
          {
            to: rows[0].email,
            ...passwordResetEmail({ url, ttlMinutes: Math.round(config.passwordResetTtlSec / 60) })
          },
          request.log
        ).catch(err => request.log.error(`password reset mail failed: ${err.message}`))
      }
    }

    return { ok: true }
  })

  app.post('/auth/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', minLength: 1, maxLength: 200 },
          password: { type: 'string', minLength: 8, maxLength: 200 }
        },
        additionalProperties: false
      }
    },
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }
  }, async (request) => {
    const claimed = await claimEmailToken(request.body.token, PURPOSE_RESET)
    if (!claimed) {
      throw badRequest('invalid_token', 'Ссылка недействительна или устарела. Запросите новую.')
    }

    const passwordHash = await hashPassword(request.body.password)
    await query(
      'update users set password_hash = $2, updated_at = now() where id = $1',
      [claimed.user_id, passwordHash]
    )

    // Recovery is what someone does when they suspect they have lost control
    // of the account. Every existing session goes.
    await revokeAllForUser(claimed.user_id, 'password_change')
    const refresh = await issueRefreshToken(claimed.user_id, request.headers['user-agent'])

    return {
      user: { id: claimed.user_id, email: claimed.email },
      accessToken: signAccessToken(claimed.user_id),
      refreshToken: refresh.token,
      expiresIn: config.accessTokenTtlSec
    }
  })

  app.post('/auth/send-verification', {
    preHandler: requireParent,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  }, async (request) => {
    const { rows } = await query(
      'select email, email_verified from users where id = $1',
      [request.userId]
    )
    if (!rows[0]) throw unauthorized('invalid_token', 'Сессия истекла, войдите заново.')
    if (rows[0].email_verified) return { ok: true, alreadyVerified: true }

    const token = await issueEmailToken(
      request.userId, PURPOSE_VERIFY, rows[0].email, config.emailVerificationTtlSec
    )
    const url = `${config.publicOrigin}/verify-email?token=${token}`
    const sent = await sendMail(
      {
        to: rows[0].email,
        ...emailVerificationEmail({ url, ttlHours: Math.round(config.emailVerificationTtlSec / 3600) })
      },
      request.log
    )

    return { ok: true, sent }
  })

  app.post('/auth/verify-email', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1, maxLength: 200 } },
        additionalProperties: false
      }
    }
  }, async (request) => {
    const claimed = await claimEmailToken(request.body.token, PURPOSE_VERIFY)
    if (!claimed) {
      throw badRequest('invalid_token', 'Ссылка недействительна или устарела. Запросите новую.')
    }

    await query(
      'update users set email_verified = true, updated_at = now() where id = $1',
      [claimed.user_id]
    )
    return { ok: true, email: claimed.email }
  })
}
