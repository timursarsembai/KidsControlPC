import { config } from '../config.js'
import { query, withTransaction } from '../db.js'
import { notFound } from '../errors.js'
import { requireParent } from '../auth/guard.js'
import { generatePairingCode } from '../pairing/codes.js'

// The agent sends a heartbeat every 30 seconds. Six missed beats before a
// device is called offline: a Windows 11 machine coming back from Modern
// Standby needs tens of seconds to get its network back, and a card that
// flickers between online and offline is worse than one that lags.
const OFFLINE_AFTER_MS = 3 * 60 * 1000

export function serializeDevice(row, { includeLogs = false } = {}) {
  const lastSeen = row.last_seen ? new Date(row.last_seen) : null

  // A stored status of 'online' only means the agent said so once. If it then
  // lost power or was killed, nothing ever writes 'offline' — so the age of
  // the last heartbeat is what actually decides.
  const stale = !lastSeen || Date.now() - lastSeen.getTime() > OFFLINE_AFTER_MS
  const status = row.status === 'online' && stale ? 'offline' : row.status

  const device = {
    id: row.id,
    hostname: row.hostname,
    osType: row.os_type,
    deviceName: row.device_name,
    alias: row.alias,
    agentVersion: row.agent_version,
    status,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
    pairedAt: row.paired_at ? new Date(row.paired_at).toISOString() : null,
    settings: row.settings ?? {},
    pomodoroState: row.pomodoro_state ?? null
  }
  // recentLogs is up to a hundred lines per device — fine when a parent opens
  // one device to diagnose it, wasteful on every list request.
  if (includeLogs) device.recentLogs = row.recent_logs ?? []
  return device
}

const DEVICE_COLUMNS = `id, hostname, os_type, device_name, alias, agent_version,
                        status, last_seen, paired_at, settings, pomodoro_state`

const patchSchema = {
  type: 'object',
  properties: {
    alias: { type: ['string', 'null'], maxLength: 100 },
    deviceName: { type: 'string', minLength: 1, maxLength: 100 },
    settings: { type: 'object' }
  },
  additionalProperties: false,
  minProperties: 1
}

// Without this a non-uuid id reaches Postgres, which raises 22P02 and turns a
// mistyped URL into a 500.
const deviceParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

const repairSchema = {
  type: 'object',
  required: ['deviceId'],
  properties: { deviceId: { type: 'string', format: 'uuid' } },
  additionalProperties: false
}

// Codes are single-use and expire in 15 minutes, the same as the Cloud
// Function had. A collision would mean two parents holding one code, so the
// insert retries rather than trusting 32^6 to never repeat.
// How many unused codes one parent may hold at once. A panel that re-requests
// on every render, or a parent clicking the button repeatedly, would otherwise
// leave thousands of live codes lying around — each of them a key to the
// account until it expires.
const MAX_LIVE_CODES = 5

async function issuePairingCode(ownerId, targetDeviceId = null) {
  const expiresAt = new Date(Date.now() + config.pairingCodeTtlSec * 1000)

  // Drop the oldest live codes over the cap, so the new one fits under it.
  await query(
    `delete from pairing_codes
      where code in (
        select code from pairing_codes
         where owner_id = $1 and used = false and expires_at > now()
         order by created_at desc
         offset $2
      )`,
    [ownerId, MAX_LIVE_CODES - 1]
  )

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePairingCode()
    try {
      await query(
        `insert into pairing_codes (code, owner_id, target_device_id, expires_at)
         values ($1, $2, $3, $4)`,
        [code, ownerId, targetDeviceId, expiresAt]
      )
      return { code, expiresAt: expiresAt.toISOString() }
    } catch (err) {
      // The code is still in the table — either live or expired but not yet
      // pruned. Either way it is taken, so draw another one.
      if (err.code === '23505') continue
      throw err
    }
  }
  throw new Error('could not allocate a unique pairing code')
}

export default async function deviceRoutes(app) {
  app.addHook('preHandler', requireParent)

  app.get('/devices', async (request) => {
    const { rows } = await query(
      `select ${DEVICE_COLUMNS} from devices where owner_id = $1 order by paired_at desc nulls last`,
      [request.userId]
    )
    return { devices: rows.map(row => serializeDevice(row)) }
  })

  app.get('/devices/:id', { schema: { params: deviceParams } }, async (request) => {
    const { rows } = await query(
      `select ${DEVICE_COLUMNS}, recent_logs from devices where id = $1 and owner_id = $2`,
      [request.params.id, request.userId]
    )
    if (!rows[0]) throw notFound('device_not_found', 'Устройство не найдено.')
    return serializeDevice(rows[0], { includeLogs: true })
  })

  app.patch('/devices/:id', { schema: { params: deviceParams, body: patchSchema } }, async (request) => {
    const { alias, deviceName, settings } = request.body

    // Settings merge rather than replace: the panel edits one switch at a
    // time and must not wipe keys it does not know about — including ones
    // written by a newer agent than the panel build.
    const { rows } = await query(
      `update devices
          set alias       = coalesce($3, alias),
              device_name = coalesce($4, device_name),
              settings    = settings || coalesce($5::jsonb, '{}'::jsonb),
              updated_at  = now()
        where id = $1 and owner_id = $2
        returning ${DEVICE_COLUMNS}`,
      [
        request.params.id,
        request.userId,
        // alias: null is a real value — clearing a custom name — so it is
        // passed through as an empty string rather than folded into coalesce.
        alias === null ? '' : alias ?? null,
        deviceName ?? null,
        settings ? JSON.stringify(settings) : null
      ]
    )
    if (!rows[0]) throw notFound('device_not_found', 'Устройство не найдено.')
    return serializeDevice(rows[0])
  })

  // Cascades to rules, commands, activity, alerts and the device secret.
  app.delete('/devices/:id', { schema: { params: deviceParams } }, async (request, reply) => {
    const { rowCount } = await query(
      'delete from devices where id = $1 and owner_id = $2',
      [request.params.id, request.userId]
    )
    if (rowCount === 0) throw notFound('device_not_found', 'Устройство не найдено.')
    return reply.code(204).send()
  })

  app.post('/pairing/codes', async (request) => {
    return issuePairingCode(request.userId)
  })

  // Re-pairing an existing device: the agent is being reinstalled on a PC that
  // already has rules and history. Pairing into the same device id is what
  // keeps them — a fresh pairing would leave the old device behind as a
  // duplicate the parent then has to clean up.
  app.post('/pairing/codes/repair', { schema: { body: repairSchema } }, async (request) => {
    const { rows } = await query(
      'select id from devices where id = $1 and owner_id = $2',
      [request.body.deviceId, request.userId]
    )
    if (!rows[0]) throw notFound('device_not_found', 'Устройство не найдено.')

    return issuePairingCode(request.userId, request.body.deviceId)
  })

  // Lets a parent cut off a device without deleting it: the current agent
  // stops being able to get a token, and the device stays with its rules
  // until it is re-paired.
  app.post('/devices/:id/revoke-secret', { schema: { params: deviceParams } }, async (request, reply) => {
    const revoked = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'select id from devices where id = $1 and owner_id = $2',
        [request.params.id, request.userId]
      )
      if (!rows[0]) return false

      await client.query('delete from device_secrets where device_id = $1', [request.params.id])
      await client.query(
        `update devices set status = 'offline', updated_at = now() where id = $1`,
        [request.params.id]
      )
      return true
    })
    if (!revoked) throw notFound('device_not_found', 'Устройство не найдено.')
    return reply.code(204).send()
  })

}
