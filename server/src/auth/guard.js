import { query } from '../db.js'
import { forbidden, unauthorized } from '../errors.js'
import { AUDIENCE_AGENT, AUDIENCE_PARENT, verifyAccessToken } from './tokens.js'

function bearerFrom(request) {
  const header = request.headers.authorization
  if (typeof header !== 'string') return null
  const [scheme, token] = header.split(' ')
  if (!token || scheme.toLowerCase() !== 'bearer') return null
  return token.trim()
}

// preHandler for every parent route. Sets request.userId on success.
//
// Deliberately does not hit the database: the token is signed and short-lived,
// so an extra SELECT on every request buys almost nothing. The cost is that a
// deleted account keeps working for up to the access-token lifetime — 15
// minutes — which is the normal trade for stateless tokens.
export async function requireParent(request) {
  const token = bearerFrom(request)
  if (!token) {
    throw unauthorized('unauthenticated', 'Требуется вход в систему.')
  }

  const payload = verifyAccessToken(token, AUDIENCE_PARENT)
  if (!payload?.sub) {
    throw unauthorized('invalid_token', 'Сессия истекла, войдите заново.')
  }

  request.userId = payload.sub

  // Whose account this request is about.
  //
  // For an owner these are the same. For an invited second parent they are
  // not: their own account holds no devices, and everything they do belongs
  // to the account that invited them.
  //
  // Resolved from the database on every request rather than carried in the
  // token: revoking access has to take effect at once, and a claim inside a
  // signed token would keep working until it expired — fifteen minutes during
  // which someone removed from a family still sees the children's activity.
  //
  // The join is what enforces the revocation: profiles.owner_id alone would
  // still point at the old account.
  request.ownerId = await resolveOwnerId(request.userId)
  request.isSecondParent = request.ownerId !== request.userId
}

/**
 * Which account this user acts on.
 *
 * Shared with the WebSocket layer, which authenticates by hand and needs the
 * same answer — a second parent subscribing to "devices" must get the
 * account's channel, not their own empty one.
 */
export async function resolveOwnerId(userId) {
  const { rows } = await query(
    `select p.owner_id,
            (a.parent_id is not null) as has_access
       from profiles p
       left join parent_access a
         on a.owner_id = p.owner_id
        and a.parent_id = p.user_id
        and a.status = 'active'
      where p.user_id = $1`,
    [userId]
  )

  const profile = rows[0]
  return (profile?.owner_id && profile.owner_id !== userId && profile.has_access)
    ? profile.owner_id
    : userId
}

// Routes only an owner may use — inviting and removing other parents. A second
// parent helping with an account must not be able to hand that account to
// someone else.
export async function requireOwner(request) {
  await requireParent(request)
  if (request.isSecondParent) {
    // 403, not 401: they are signed in perfectly well, this is simply not
    // theirs to do. A 401 would send the panel to the login screen.
    throw forbidden('owner_only', 'Это может сделать только владелец аккаунта.')
  }
}

// preHandler for agent routes. Sets request.deviceId and request.ownerId.
//
// The device the agent may touch is `sub` — the id it was paired as. Nothing
// in the request body can widen that: an agent asking about another device
// gets its own rows regardless of what it sent.
export async function requireAgent(request) {
  const token = bearerFrom(request)
  if (!token) {
    throw unauthorized('unauthenticated', 'Device token required.')
  }

  const payload = verifyAccessToken(token, AUDIENCE_AGENT)
  if (!payload?.sub || !payload.ownerId) {
    throw unauthorized('invalid_token', 'Device token expired or invalid.')
  }

  request.deviceId = payload.sub
  request.ownerId = payload.ownerId
}
