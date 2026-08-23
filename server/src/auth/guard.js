import { unauthorized } from '../errors.js'
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
