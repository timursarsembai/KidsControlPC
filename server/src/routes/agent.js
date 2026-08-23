// Routes the agent on a child's PC calls. Everything here is written with one
// constraint in mind: the agent is packaged with pkg on Node 18.5, where
// global fetch and undici do not work. These are plain JSON over HTTPS, which
// the agent can reach with the built-in https module.

import { randomUUID } from 'node:crypto'
import { withTransaction, query } from '../db.js'
import { badRequest, notFound, unauthorized } from '../errors.js'
import { requireAgent } from '../auth/guard.js'
import { deviceSecretMatches, generateDeviceSecret, hashDeviceSecret } from '../auth/deviceSecret.js'
import { signAgentToken } from '../auth/tokens.js'
import { config } from '../config.js'
import { normalizePairingCode } from '../pairing/codes.js'

const pairSchema = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 20 },
    hostname: { type: 'string', maxLength: 100 },
    osType: { type: 'string', maxLength: 50 },
    agentVersion: { type: 'string', maxLength: 20 }
  },
  additionalProperties: false
}

const tokenSchema = {
  type: 'object',
  required: ['deviceId', 'deviceSecret'],
  properties: {
    deviceId: { type: 'string', format: 'uuid' },
    deviceSecret: { type: 'string', minLength: 1, maxLength: 200 }
  },
  additionalProperties: false
}

const heartbeatSchema = {
  type: 'object',
  properties: {
    agentVersion: { type: 'string', maxLength: 20 },
    status: { type: 'string', enum: ['online', 'offline'] }
  },
  additionalProperties: false
}

export default async function agentRoutes(app) {
  // A pairing code is six characters from a 32-symbol alphabet — a billion
  // combinations, but guessing is still worth denying. Tighter than the global
  // limit because a legitimate agent pairs once, not repeatedly.
  app.post('/agent/pair', {
    schema: { body: pairSchema },
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }
  }, async (request) => {
    const code = normalizePairingCode(request.body.code)
    if (!code) {
      throw badRequest('invalid_code', 'Код состоит из шести символов.')
    }

    const hostname = request.body.hostname || null
    const osType = request.body.osType || null
    const agentVersion = request.body.agentVersion || null

    // A fresh secret on every pairing, including a repair pairing: the copy
    // left on the PC being replaced stops working, which is the point.
    const secret = generateDeviceSecret()

    const result = await withTransaction(async (client) => {
      // Claiming the code with the UPDATE itself is what makes it single-use.
      // Checking first and updating after would let two agents racing on the
      // same code both pair.
      const claimed = await client.query(
        `update pairing_codes
            set used = true, used_at = now()
          where code = $1 and used = false and expires_at > now()
          returning owner_id, target_device_id`,
        [code]
      )
      if (claimed.rowCount === 0) return null

      const { owner_id: ownerId, target_device_id: targetDeviceId } = claimed.rows[0]

      let deviceId
      if (targetDeviceId) {
        // Repair pairing. device_name and alias are deliberately left alone:
        // the parent named this PC, and reinstalling an agent is no reason to
        // take that name away.
        const updated = await client.query(
          `update devices
              set hostname = coalesce($3, hostname),
                  os_type = coalesce($4, os_type),
                  agent_version = coalesce($5, agent_version),
                  paired_at = now(), last_seen = now(),
                  status = 'online', updated_at = now()
            where id = $1 and owner_id = $2
            returning id`,
          [targetDeviceId, ownerId, hostname, osType, agentVersion]
        )
        // The device was deleted between issuing the code and using it. Throw
        // so the transaction rolls back and the code is not burned.
        if (updated.rowCount === 0) {
          throw notFound('device_not_found', 'Устройство больше не существует.')
        }
        deviceId = targetDeviceId
      } else {
        deviceId = randomUUID()
        await client.query(
          `insert into devices (id, owner_id, hostname, os_type, device_name,
                                agent_version, status, last_seen, paired_at)
           values ($1, $2, $3, $4, $3, $5, 'online', now(), now())`,
          [deviceId, ownerId, hostname, osType, agentVersion]
        )
      }

      await client.query(
        `insert into device_secrets (device_id, secret_hash)
         values ($1, $2)
         on conflict (device_id) do update
           set secret_hash = excluded.secret_hash, rotated_at = now()`,
        [deviceId, hashDeviceSecret(secret)]
      )

      await client.query('update pairing_codes set device_id = $1 where code = $2', [deviceId, code])

      return { ownerId, deviceId }
    })

    if (!result) {
      // One message for unknown, expired and already-used. Distinguishing them
      // tells someone guessing codes which guesses were nearly right.
      throw badRequest('invalid_code', 'Код не найден или уже использован.')
    }

    return {
      ownerId: result.ownerId,
      deviceId: result.deviceId,
      deviceSecret: secret
    }
  })

  // Trades the stored secret for a short-lived token. Called at startup and
  // whenever the token is about to expire.
  app.post('/agent/token', {
    schema: { body: tokenSchema },
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } }
  }, async (request) => {
    const { rows } = await query(
      `select s.secret_hash, d.owner_id
         from device_secrets s
         join devices d on d.id = s.device_id
        where s.device_id = $1`,
      [request.body.deviceId]
    )
    const row = rows[0]

    // Same answer for an unknown device and a wrong secret.
    if (!row || !deviceSecretMatches(request.body.deviceSecret, row.secret_hash)) {
      throw unauthorized('invalid_device_secret', 'Device is not paired. Re-pair it.')
    }

    return {
      accessToken: signAgentToken(request.body.deviceId, row.owner_id),
      expiresIn: config.agentTokenTtlSec
    }
  })

  // Everything below needs a device token.
  app.register(async (secured) => {
    secured.addHook('preHandler', requireAgent)

    // The agent beats every 30 seconds, so this is by far the most frequent
    // request in the system: one statement, no reads, no transaction.
    secured.post('/agent/heartbeat', { schema: { body: heartbeatSchema } }, async (request) => {
      // The `exists` clause is what makes revoking a secret take effect
      // quickly. Without it a parent who cut a device off would still be
      // feeding it for up to an hour — the remaining life of a token issued
      // before the revocation. Folded into the update rather than checked
      // separately: this is the most frequent request in the system, and it
      // stays one round trip.
      const { rowCount } = await query(
        `update devices
            set last_seen = now(),
                status = coalesce($2, 'online'),
                agent_version = coalesce($3, agent_version),
                updated_at = now()
          where id = $1
            and exists (select 1 from device_secrets where device_id = $1)`,
        [request.deviceId, request.body?.status ?? null, request.body?.agentVersion ?? null]
      )
      if (rowCount === 0) {
        // Deleted or cut off — the agent cannot tell the two apart, and does
        // not need to: in both cases its job is to stop and wait to be
        // re-paired, not to keep beating.
        throw unauthorized('device_unpaired', 'Device is no longer paired. Re-pair it.')
      }
      return { ok: true }
    })

    // Lets an agent confirm what it is paired to without a heartbeat write —
    // used on startup and after a long offline stretch.
    secured.get('/agent/me', async (request) => {
      const { rows } = await query(
        `select d.id, d.owner_id, d.device_name, d.alias, d.status
           from devices d
           join device_secrets s on s.device_id = d.id
          where d.id = $1`,
        [request.deviceId]
      )
      if (!rows[0]) throw unauthorized('device_unpaired', 'Device is no longer paired. Re-pair it.')
      return {
        deviceId: rows[0].id,
        ownerId: rows[0].owner_id,
        deviceName: rows[0].device_name,
        alias: rows[0].alias
      }
    })
  })
}
