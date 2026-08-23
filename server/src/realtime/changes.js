// Listens to the Postgres channel the triggers write to and re-emits each
// change locally. This is the replacement for Firestore's onSnapshot plumbing.
//
// A dedicated connection, not one borrowed from the pool: a LISTEN is bound to
// its session, and a pooled client handed back would stop listening the moment
// somebody else used it.

import { EventEmitter } from 'node:events'
import pg from 'pg'
import { config } from '../config.js'

export const changes = new EventEmitter()

const CHANNEL = 'kidscontrol_changes'
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

let client = null
let stopped = false
let retryDelay = RECONNECT_MIN_MS
let reconnectTimer = null

function scheduleReconnect(log) {
  if (stopped || reconnectTimer) return

  const delay = retryDelay
  retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect(log)
  }, delay)
  reconnectTimer.unref()
  log.warn(`change listener: reconnecting in ${delay}ms`)
}

async function connect(log) {
  if (stopped) return

  client = new pg.Client({ connectionString: config.databaseUrl })

  // Losing this connection must not take the process down — the API keeps
  // serving requests, it just stops pushing live updates until the listener
  // is back. Killing the process instead would turn a database blip into
  // downtime for every parent.
  client.on('error', (err) => {
    log.warn(`change listener: ${err.message}`)
    try { client.end() } catch { /* already gone */ }
    client = null
    scheduleReconnect(log)
  })

  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return
    try {
      changes.emit('change', JSON.parse(msg.payload))
    } catch (err) {
      log.warn(`change listener: unreadable payload: ${err.message}`)
    }
  })

  try {
    await client.connect()
    await client.query(`listen ${CHANNEL}`)
    retryDelay = RECONNECT_MIN_MS
    log.info('change listener: connected')

    // Anything that happened while the connection was down was missed. Tell
    // subscribers to refetch rather than pretend nothing changed — a rule the
    // panel never learned about is worse than an extra query.
    changes.emit('resync')
  } catch (err) {
    log.warn(`change listener: connect failed: ${err.message}`)
    client = null
    scheduleReconnect(log)
  }
}

// Reported by /health as extra detail. Deliberately does not make ok=false:
// with the listener down, rules still reach the agent over the REST fallback
// and the panel still loads — that is degraded, not broken, and paging someone
// at night over it would be a false alarm.
export function isChangeListenerConnected() {
  return client !== null
}

export function startChangeListener(log) {
  stopped = false
  return connect(log)
}

export async function stopChangeListener() {
  stopped = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (client) {
    const c = client
    client = null
    try { await c.end() } catch { /* already gone */ }
  }
  changes.removeAllListeners()
}
