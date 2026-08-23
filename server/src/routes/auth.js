import { config } from '../config.js'
import { query, withTransaction } from '../db.js'
import { badRequest, conflict, unauthorized } from '../errors.js'
import { looksLikeEmail, normalizeEmail } from '../auth/email.js'
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../auth/password.js'
import {
  issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken
} from '../auth/tokens.js'
import { requireParent } from '../auth/guard.js'

// Same value as the column default and as DEFAULT_QUOTA_BYTES in
// shared/firebase/profile.repo.js — the free plan's 100 MB.
const DEFAULT_QUOTA_BYTES = 100 * 1024 * 1024

const credentialsSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 254 },
    // Length is the only rule. Composition requirements (a digit, a capital,
    // a symbol) push people toward "Password1!" and are no longer recommended
    // by anyone who measures the result.
    password: { type: 'string', minLength: 8, maxLength: 200 }
  },
  additionalProperties: false
}

const refreshSchema = {
  type: 'object',
  required: ['refreshToken'],
  properties: { refreshToken: { type: 'string', minLength: 1, maxLength: 200 } },
  additionalProperties: false
}

function sessionResponse(userId, email, refreshToken) {
  return {
    user: { id: userId, email },
    accessToken: signAccessToken(userId),
    refreshToken,
    expiresIn: config.accessTokenTtlSec
  }
}

export default async function authRoutes(app) {
  // Registration and login are the two routes worth guessing at, so they get a
  // tighter limit than the global one. Keyed by IP: without an account there is
  // nothing else to key on.
  const strictLimit = {
    config: {
      rateLimit: { max: 10, timeWindow: '5 minutes' }
    }
  }

  app.post('/auth/register', { schema: { body: credentialsSchema }, ...strictLimit }, async (request, reply) => {
    const email = normalizeEmail(request.body.email)
    if (!looksLikeEmail(email)) {
      throw badRequest('invalid_email', 'Проверьте адрес электронной почты.')
    }

    const passwordHash = await hashPassword(request.body.password)

    const user = await withTransaction(async (client) => {
      // The unique index is what actually prevents duplicates — two
      // simultaneous registrations would both pass a prior SELECT.
      let inserted
      try {
        const result = await client.query(
          'insert into users (email, password_hash) values ($1, $2) returning id, email',
          [email, passwordHash]
        )
        inserted = result.rows[0]
      } catch (err) {
        if (err.code === '23505') {
          throw conflict('email_taken', 'Этот адрес уже зарегистрирован.')
        }
        throw err
      }

      await client.query(
        'insert into profiles (user_id, owner_id, role) values ($1, $1, $2)',
        [inserted.id, 'owner']
      )
      return inserted
    })

    const refresh = await issueRefreshToken(user.id, request.headers['user-agent'])
    return reply.code(201).send(sessionResponse(user.id, user.email, refresh.token))
  })

  app.post('/auth/login', { schema: { body: credentialsSchema }, ...strictLimit }, async (request) => {
    const email = normalizeEmail(request.body.email)

    const { rows } = await query(
      'select id, email, password_hash from users where lower(email) = $1',
      [email]
    )
    const user = rows[0]

    // Same answer and the same amount of work whether the address is unknown
    // or the password is wrong. Telling those apart hands over a list of who
    // has an account here — and these are accounts about children.
    if (!user) {
      await verifyAgainstDummy(request.body.password)
      throw unauthorized('invalid_credentials', 'Неверная почта или пароль.')
    }

    const ok = await verifyPassword(request.body.password, user.password_hash)
    if (!ok) {
      throw unauthorized('invalid_credentials', 'Неверная почта или пароль.')
    }

    const refresh = await issueRefreshToken(user.id, request.headers['user-agent'])
    return sessionResponse(user.id, user.email, refresh.token)
  })

  app.post('/auth/refresh', { schema: { body: refreshSchema } }, async (request) => {
    const rotated = await rotateRefreshToken(request.body.refreshToken, request.headers['user-agent'])
    if (!rotated) {
      throw unauthorized('invalid_refresh_token', 'Сессия истекла, войдите заново.')
    }

    const { rows } = await query('select email from users where id = $1', [rotated.userId])
    if (!rows[0]) {
      throw unauthorized('invalid_refresh_token', 'Сессия истекла, войдите заново.')
    }

    return sessionResponse(rotated.userId, rows[0].email, rotated.token)
  })

  // Logging out with an already-invalid token still answers 204: the caller
  // wanted the session gone, and it is gone.
  app.post('/auth/logout', { schema: { body: refreshSchema } }, async (request, reply) => {
    await revokeRefreshToken(request.body.refreshToken)
    return reply.code(204).send()
  })

  // Emergency unlock: turns every rule on every device off at once. Lives on
  // the profile because it is an account-wide switch, not a device one.
  app.patch('/me', {
    preHandler: requireParent,
    schema: {
      body: {
        type: 'object',
        properties: {
          pauseAllRules: { type: 'boolean' },
          chatName: { type: 'string', maxLength: 100 }
        },
        additionalProperties: false,
        minProperties: 1
      }
    }
  }, async (request) => {
    const { rows } = await query(
      `update profiles
          set pause_all_rules = coalesce($2, pause_all_rules),
              chat_name = coalesce($3, chat_name),
              updated_at = now()
        where user_id = $1
        returning pause_all_rules, chat_name`,
      [request.userId, request.body.pauseAllRules ?? null, request.body.chatName ?? null]
    )
    if (!rows[0]) throw unauthorized('invalid_token', 'Сессия истекла, войдите заново.')
    return { pauseAllRules: rows[0].pause_all_rules, chatName: rows[0].chat_name }
  })

  // Deleting the account takes the devices, rules and history with it. The
  // password is asked for again because an access token left open on a shared
  // computer should not be enough to erase a family's account.
  app.delete('/me', {
    preHandler: requireParent,
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string', minLength: 1, maxLength: 200 } },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { rows } = await query('select password_hash from users where id = $1', [request.userId])
    if (!rows[0]) throw unauthorized('invalid_token', 'Сессия истекла, войдите заново.')

    const ok = await verifyPassword(request.body.password, rows[0].password_hash)
    if (!ok) throw unauthorized('invalid_credentials', 'Неверный пароль.')

    await query('delete from users where id = $1', [request.userId])
    return reply.code(204).send()
  })

  app.get('/me', { preHandler: requireParent }, async (request) => {
    const { rows } = await query(
      `select u.id, u.email, u.email_verified,
              p.plan, p.role, p.owner_id, p.chat_name,
              p.storage_used_bytes, p.storage_quota_bytes, p.pause_all_rules
         from users u
         left join profiles p on p.user_id = u.id
        where u.id = $1`,
      [request.userId]
    )
    const row = rows[0]
    if (!row) {
      throw unauthorized('invalid_token', 'Сессия истекла, войдите заново.')
    }

    // An account imported from Firestore can arrive without a profile row, and
    // the left join then yields nulls. Number(null) is 0 — which would show the
    // parent a storage quota of zero and an account that looks out of space.
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified,
      plan: row.plan ?? 'free',
      role: row.role ?? 'owner',
      ownerId: row.owner_id ?? row.id,
      chatName: row.chat_name,
      storageUsedBytes: Number(row.storage_used_bytes ?? 0),
      storageQuotaBytes: Number(row.storage_quota_bytes ?? DEFAULT_QUOTA_BYTES),
      pauseAllRules: row.pause_all_rules ?? false
    }
  })
}
