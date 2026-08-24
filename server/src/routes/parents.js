// A second parent: inviting one, accepting an invitation, and taking access
// away again.
//
// Only the owner invites. A second parent helping with an account must not be
// able to hand that account to someone else — that is the whole point of the
// distinction, and it is enforced by requireOwner rather than by the panel
// hiding a button.

import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { query, withTransaction } from '../db.js'
import { badRequest, conflict, notFound } from '../errors.js'
import { looksLikeEmail, normalizeEmail } from '../auth/email.js'
import { hashPassword } from '../auth/password.js'
import { requireOwner, requireParent } from '../auth/guard.js'
import { mailEnabled, sendMail } from '../mail/mailer.js'
import { parentInvitationEmail } from '../mail/templates.js'

const INVITATION_TTL_SEC = 24 * 60 * 60

// Readable when read aloud or copied from a note — the same alphabet the
// import script uses for temporary passwords.
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function temporaryPassword() {
  const bytes = randomBytes(12)
  let out = ''
  for (const byte of bytes) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

function serializeInvitation(row) {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null
  }
}

export default async function parentRoutes(app) {
  // Reading who has access is fine for a second parent — they can see they are
  // there. Everything that changes access needs the owner.
  app.get('/parents', { preHandler: requireParent }, async (request) => {
    const [access, invitations] = await Promise.all([
      query(
        `select a.parent_id, a.status, a.accepted_at, u.email
           from parent_access a
           join users u on u.id = a.parent_id
          where a.owner_id = $1
          order by a.accepted_at desc`,
        [request.ownerId]
      ),
      query(
        `select id, email, status, created_at, expires_at, responded_at
           from parent_invitations
          where owner_id = $1
          order by created_at desc
          limit 50`,
        [request.ownerId]
      )
    ])

    return {
      access: access.rows.map(row => ({
        parentUid: row.parent_id,
        email: row.email,
        status: row.status,
        acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null
      })),
      invitations: invitations.rows.map(serializeInvitation)
    }
  })

  app.post('/parents/invitations', {
    preHandler: requireOwner,
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', minLength: 3, maxLength: 254 } },
        additionalProperties: false
      }
    },
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }
  }, async (request, reply) => {
    // Without mail the invitation cannot reach anyone, and an invitation
    // nobody receives is a row in a table pretending to be a feature.
    if (!mailEnabled) {
      throw badRequest('mail_not_configured',
        'Почта не настроена — приглашение отправить некуда.')
    }

    const email = normalizeEmail(request.body.email)
    if (!looksLikeEmail(email)) {
      throw badRequest('invalid_email', 'Проверьте адрес электронной почты.')
    }

    const { rows: ownerRows } = await query('select email from users where id = $1', [request.ownerId])
    if (normalizeEmail(ownerRows[0]?.email) === email) {
      throw badRequest('cannot_invite_self', 'Это ваш собственный адрес.')
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITATION_TTL_SEC * 1000)
    let temporary = null

    const invitation = await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        'select id from users where lower(email) = $1',
        [email]
      )
      let invitedUserId = existing[0]?.id ?? null
      let accountCreated = false

      // An invitation to someone with no account creates one, so the link in
      // the letter leads somewhere they can actually sign in. The password
      // travels in the same letter and is theirs to change.
      if (!invitedUserId) {
        temporary = temporaryPassword()
        const passwordHash = await hashPassword(temporary)
        const { rows: created } = await client.query(
          'insert into users (email, password_hash) values ($1, $2) returning id',
          [email, passwordHash]
        )
        invitedUserId = created[0].id
        accountCreated = true
        await client.query(
          'insert into profiles (user_id, owner_id, role) values ($1, $1, $2)',
          [invitedUserId, 'owner']
        )
      }

      if (invitedUserId === request.ownerId) {
        throw badRequest('cannot_invite_self', 'Это ваш собственный адрес.')
      }

      const { rows: alreadyThere } = await client.query(
        `select 1 from parent_access
          where owner_id = $1 and parent_id = $2 and status = 'active'`,
        [request.ownerId, invitedUserId]
      )
      if (alreadyThere.length > 0) {
        throw conflict('already_has_access', 'У этого родителя уже есть доступ.')
      }

      // Replaces any pending invitation to the same address: sending a second
      // one should not leave two working links in a mailbox.
      await client.query(
        `update parent_invitations
            set status = 'expired', responded_at = now()
          where owner_id = $1 and lower(email) = $2 and status = 'pending'`,
        [request.ownerId, email]
      )

      const { rows } = await client.query(
        `insert into parent_invitations
           (owner_id, email, invited_user_id, account_created, token_hash, expires_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id, email, status, created_at, expires_at, responded_at`,
        [request.ownerId, email, invitedUserId, accountCreated, sha256(token), expiresAt]
      )
      return rows[0]
    })

    const url = `${config.publicOrigin}/invite?invitationId=${invitation.id}&token=${token}`
    const sent = await sendMail(
      {
        to: email,
        ...parentInvitationEmail({
          url,
          ownerEmail: ownerRows[0]?.email,
          temporaryPassword: temporary,
          ttlHours: Math.round(INVITATION_TTL_SEC / 3600)
        })
      },
      request.log
    )

    // Not rolled back if the letter failed: the invitation is valid and can be
    // resent. Saying so lets the owner decide, instead of silently reporting
    // success for something nobody received.
    return reply.code(201).send({
      ...serializeInvitation(invitation),
      accountCreated: Boolean(temporary),
      sent
    })
  })

  /**
   * What the invited person sees before deciding. Answers with the token
   * alone — they may not have signed in yet, and the link is what proves they
   * were invited.
   */
  app.get('/parents/invitations/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1, maxLength: 200 } }
      }
    }
  }, async (request) => {
    const { rows } = await query(
      `select i.id, i.email, i.status, i.expires_at, u.email as owner_email
         from parent_invitations i
         join users u on u.id = i.owner_id
        where i.id = $1 and i.token_hash = $2`,
      [request.params.id, sha256(request.query.token)]
    )
    const invitation = rows[0]
    if (!invitation) throw notFound('invitation_not_found', 'Приглашение не найдено.')

    const expired = new Date(invitation.expires_at).getTime() <= Date.now()
    return {
      id: invitation.id,
      email: invitation.email,
      ownerEmail: invitation.owner_email,
      status: expired && invitation.status === 'pending' ? 'expired' : invitation.status,
      expiresAt: new Date(invitation.expires_at).toISOString()
    }
  })

  app.post('/parents/invitations/:id/accept', {
    preHandler: requireParent,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1, maxLength: 200 } },
        additionalProperties: false
      }
    }
  }, async (request) => {
    return withTransaction(async (client) => {
      // Claimed by the UPDATE so two clicks cannot both accept, and checked
      // against who is signed in: an invitation is addressed to one person,
      // and a link forwarded to somebody else must not work for them.
      const { rows } = await client.query(
        `update parent_invitations
            set status = 'accepted', responded_at = now()
          where id = $1
            and token_hash = $2
            and status = 'pending'
            and expires_at > now()
            and invited_user_id = $3
          returning owner_id`,
        [request.params.id, sha256(request.body.token), request.userId]
      )
      if (!rows[0]) {
        throw badRequest('invitation_not_available',
          'Приглашение недействительно, устарело или адресовано другому человеку.')
      }
      const ownerId = rows[0].owner_id

      // A parent helps with exactly one account — that is what profiles.owner_id
      // encodes. Accepting a second invitation would silently overwrite it and
      // take away access to the first family without telling anyone.
      const { rows: elsewhere } = await client.query(
        `select 1 from parent_access
          where parent_id = $1 and owner_id <> $2 and status = 'active'`,
        [request.userId, ownerId]
      )
      if (elsewhere.length > 0) {
        throw conflict('already_helps_another_account',
          'Вы уже помогаете с другим аккаунтом. Сначала выйдите из него.')
      }

      await client.query(
        `insert into parent_access (owner_id, parent_id, invitation_id)
         values ($1, $2, $3)
         on conflict (owner_id, parent_id) do update
           set status = 'active', revoked_at = null, accepted_at = now(),
               invitation_id = excluded.invitation_id`,
        [ownerId, request.userId, request.params.id]
      )

      // This is what makes every other route return the owner's data: the
      // profile now points at the account being helped with.
      await client.query(
        `update profiles set owner_id = $2, role = 'parent', updated_at = now()
          where user_id = $1`,
        [request.userId, ownerId]
      )

      return { ok: true, ownerId }
    })
  })

  app.post('/parents/invitations/:id/decline', {
    preHandler: requireParent,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1, maxLength: 200 } },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    await query(
      `update parent_invitations
          set status = 'declined', responded_at = now()
        where id = $1 and token_hash = $2 and status = 'pending'
          and invited_user_id = $3`,
      [request.params.id, sha256(request.body.token), request.userId]
    )
    return reply.code(204).send()
  })

  app.delete('/parents/:parentId', {
    preHandler: requireOwner,
    schema: {
      params: {
        type: 'object',
        required: ['parentId'],
        properties: { parentId: { type: 'string', format: 'uuid' } }
      }
    }
  }, async (request, reply) => {
    const removed = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `update parent_access
            set status = 'revoked', revoked_at = now()
          where owner_id = $1 and parent_id = $2 and status = 'active'`,
        [request.ownerId, request.params.parentId]
      )
      if (rowCount === 0) return false

      // Point their profile back at themselves. Without this they would keep
      // an owner_id they no longer have access to — harmless, because the
      // access check is what decides, but it would show as a broken account.
      await client.query(
        `update profiles set owner_id = user_id, role = 'owner', updated_at = now()
          where user_id = $1 and owner_id = $2`,
        [request.params.parentId, request.ownerId]
      )

      // Their sessions stay valid — they are still a legitimate user, just
      // without this account. The next request resolves to their own.
      return true
    })

    if (!removed) throw notFound('access_not_found', 'У этого родителя нет доступа.')
    return reply.code(204).send()
  })
}
