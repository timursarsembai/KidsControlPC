// The WebSocket surface: one socket per client, channels subscribed on it.
// Replaces 40-odd onSnapshot listeners.
//
// The token arrives in the first frame, not in a query string or a header.
// Browsers cannot set headers on a WebSocket, and a token in the URL ends up
// in the Nginx access log — and from there in the off-site backup.

import { query } from '../db.js'
import { AUDIENCE_AGENT, AUDIENCE_PARENT, verifyAccessToken } from '../auth/tokens.js'
import {
  ALERT_COLUMNS, APP_COLUMNS, COMMAND_COLUMNS, DEVICE_COLUMNS, RULE_COLUMNS,
  serializeAlert, serializeApp, serializeCommand, serializeDevice, serializeRule
} from '../serializers.js'
import { channelFor } from './hub.js'

const AUTH_TIMEOUT_MS = 10_000
const PING_INTERVAL_MS = 30_000
const MAX_CHANNELS_PER_SOCKET = 50

// The HTTP rate limiter counts requests, and a WebSocket is a single request.
// Without a cap here, one authenticated client can send subscribe frames in a
// loop — each of them an ownership check plus a snapshot query — and the
// channel cap does not stop it, because re-subscribing to a channel already
// held does not grow the set.
const MAX_FRAMES_PER_WINDOW = 60
const FRAME_WINDOW_MS = 10_000
const CLOSE_FLOODING = 4004

// Close codes above 4000 are application-defined.
const CLOSE_AUTH_TIMEOUT = 4001
const CLOSE_BAD_TOKEN = 4002
const CLOSE_PROTOCOL = 4003

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function snapshotDevices(ownerId) {
  const { rows } = await query(
    `select ${DEVICE_COLUMNS} from devices where owner_id = $1 order by paired_at desc nulls last`,
    [ownerId]
  )
  return rows.map(row => serializeDevice(row))
}

async function snapshotDevice(deviceId) {
  const { rows } = await query(`select ${DEVICE_COLUMNS} from devices where id = $1`, [deviceId])
  return rows[0] ? [serializeDevice(rows[0])] : []
}

async function snapshotRules(deviceId) {
  const { rows } = await query(
    `select ${RULE_COLUMNS} from rules where device_id = $1 order by created_at desc`,
    [deviceId]
  )
  return rows.map(serializeRule)
}

async function snapshotAlerts(ownerId) {
  const { rows } = await query(
    `select ${ALERT_COLUMNS} from alerts where owner_id = $1 order by created_at desc limit 200`,
    [ownerId]
  )
  return rows.map(serializeAlert)
}

async function snapshotCommands(deviceId, { pendingOnly = false } = {}) {
  const { rows } = await query(
    `select ${COMMAND_COLUMNS} from commands
      where device_id = $1 ${pendingOnly ? "and status = 'pending'" : ''}
      order by created_at desc
      limit 100`,
    [deviceId]
  )
  return rows.map(serializeCommand)
}

async function snapshotApps(deviceId) {
  const { rows } = await query(
    `select ${APP_COLUMNS} from installed_apps where device_id = $1 order by lower(name)`,
    [deviceId]
  )
  return rows.map(serializeApp)
}

async function ownsDevice(ownerId, deviceId) {
  const { rows } = await query(
    'select 1 from devices where id = $1 and owner_id = $2',
    [deviceId, ownerId]
  )
  return rows.length > 0
}

const PER_DEVICE_CHANNELS = new Set(['device', 'rules', 'commands', 'apps'])

/**
 * Resolves a channel name the client asked for into an internal one, or null
 * if this client may not have it.
 *
 * Every allowed channel is derived from the token, never from the request:
 * a parent asking for 'devices' gets their own account's channel, and asking
 * for another account's device fails the ownership check.
 */
async function resolveChannel(client, requested) {
  if (client.kind === AUDIENCE_PARENT) {
    if (requested === 'devices') return channelFor.devices(client.userId)
    if (requested === 'alerts') return channelFor.alerts(client.userId)

    const [kind, id] = requested.split(':')
    if (!id || !UUID_RE.test(id)) return null
    if (!PER_DEVICE_CHANNELS.has(kind)) return null
    if (!await ownsDevice(client.userId, id)) return null

    return channelFor[kind](id)
  }

  // An agent may only watch itself. Its own device id comes from the token, so
  // the id in the request is not even consulted.
  if (requested === 'device') return channelFor.device(client.deviceId)
  if (requested === 'rules') return channelFor.rules(client.deviceId)
  if (requested === 'commands') return channelFor.commands(client.deviceId)
  return null
}

async function snapshotFor(channel, client) {
  const [kind, id] = channel.split(':')
  if (kind === 'devices') return snapshotDevices(id)
  if (kind === 'device') return snapshotDevice(id)
  if (kind === 'rules') return snapshotRules(id)
  if (kind === 'alerts') return snapshotAlerts(id)
  if (kind === 'apps') return snapshotApps(id)
  if (kind === 'commands') {
    // The agent only wants what it still has to do; the panel wants recent
    // history, including what already ran, to show a command's outcome.
    return snapshotCommands(id, { pendingOnly: client?.kind === AUDIENCE_AGENT })
  }
  return []
}

export default async function websocketRoutes(app, { hub }) {
  function attach(socket, client) {
    // Internal channel name -> the name this client used to subscribe. The
    // agent says 'rules' and the hub keys 'rules:<uuid>'; a patch labelled
    // with the internal name would not match the snapshot the client already
    // holds, and it would file the update under a channel it never asked for.
    client.aliases = new Map()
    client.send = (message, channel) => {
      const ch = channel ? client.aliases.get(channel) ?? channel : message.ch
      socket.send(JSON.stringify(ch ? { ...message, ch } : message))
    }
    hub.add(client)

    // ws answers ping frames by itself, so this measures the socket, not the
    // application. A child's PC that suspends leaves a socket that looks open
    // for hours otherwise, and the hub keeps broadcasting into it.
    let alive = true
    socket.on('pong', () => { alive = true })
    const pinger = setInterval(() => {
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      try { socket.ping() } catch { /* closing */ }
    }, PING_INTERVAL_MS)

    socket.on('close', () => {
      clearInterval(pinger)
      hub.remove(client)
    })
    socket.on('error', () => {
      clearInterval(pinger)
      hub.remove(client)
    })
  }

  async function handleSubscribe(socket, client, requested) {
    const channel = await resolveChannel(client, requested)
    if (!channel) {
      socket.send(JSON.stringify({
        t: 'error', ch: requested, code: 'forbidden_channel'
      }))
      return
    }

    if (client.channels.size >= MAX_CHANNELS_PER_SOCKET) {
      socket.send(JSON.stringify({ t: 'error', ch: requested, code: 'too_many_channels' }))
      return
    }

    client.aliases.set(channel, requested)
    hub.subscribe(client, channel)
    // The snapshot is sent after subscribing, not before: a change landing in
    // between then arrives as a patch on top of it. The other order loses it.
    const data = await snapshotFor(channel, client)
    socket.send(JSON.stringify({ t: 'snap', ch: requested, data }))
  }

  function makeHandler(audience) {
    return (socket, request) => {
      let client = null

      const authTimer = setTimeout(() => {
        if (!client) socket.close(CLOSE_AUTH_TIMEOUT, 'auth timeout')
      }, AUTH_TIMEOUT_MS)
      authTimer.unref()

      let windowStart = Date.now()
      let framesInWindow = 0

      socket.on('message', async (raw) => {
        const now = Date.now()
        if (now - windowStart > FRAME_WINDOW_MS) {
          windowStart = now
          framesInWindow = 0
        }
        if (++framesInWindow > MAX_FRAMES_PER_WINDOW) {
          socket.close(CLOSE_FLOODING, 'too many frames')
          return
        }

        let msg
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          socket.close(CLOSE_PROTOCOL, 'malformed frame')
          return
        }

        try {
          if (!client) {
            if (msg.t !== 'auth' || typeof msg.token !== 'string') {
              socket.close(CLOSE_PROTOCOL, 'auth first')
              return
            }
            const payload = verifyAccessToken(msg.token, audience)
            if (!payload?.sub) {
              socket.close(CLOSE_BAD_TOKEN, 'invalid token')
              return
            }
            clearTimeout(authTimer)

            client = audience === AUDIENCE_PARENT
              ? { kind: AUDIENCE_PARENT, userId: payload.sub }
              : { kind: AUDIENCE_AGENT, deviceId: payload.sub, ownerId: payload.ownerId }
            attach(socket, client)

            socket.send(JSON.stringify({ t: 'ready' }))

            // An agent has exactly one thing to watch, and needs it before it
            // can enforce anything. Making it ask would only add a round trip
            // on the slowest link in the system.
            if (client.kind === AUDIENCE_AGENT) {
              await handleSubscribe(socket, client, 'rules')
              await handleSubscribe(socket, client, 'device')
              await handleSubscribe(socket, client, 'commands')
            }
            return
          }

          if (msg.t === 'sub' && typeof msg.ch === 'string') {
            await handleSubscribe(socket, client, msg.ch)
          } else if (msg.t === 'unsub' && typeof msg.ch === 'string') {
            // Looked up among what this client actually holds, not resolved
            // again: resolving re-checks ownership, so a device deleted while
            // the panel was open could never be unsubscribed from, and the
            // subscription would sit in the hub until the socket closed.
            for (const [channel, alias] of client.aliases) {
              if (alias !== msg.ch) continue
              hub.unsubscribe(client, channel)
              client.aliases.delete(channel)
            }
          } else if (msg.t === 'ping') {
            socket.send(JSON.stringify({ t: 'pong' }))
          }
        } catch (err) {
          // One bad frame must not drop a connection the agent depends on for
          // rule delivery — it would reconnect, but it would also stop
          // enforcing changes for as long as that takes.
          request.log.warn(`ws frame failed: ${err.message}`)
        }
      })
    }
  }

  app.get('/ws', { websocket: true }, makeHandler(AUDIENCE_PARENT))
  app.get('/ws/agent', { websocket: true }, makeHandler(AUDIENCE_AGENT))
}
