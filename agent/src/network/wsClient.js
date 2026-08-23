// Live channel to the self-hosted backend.
//
// Two rules govern this file, both bought expensively:
//
// 1. Losing the connection is never fatal. Three failed heartbeats used to
//    call process.exit(1); on Windows 11 with Modern Standby the network comes
//    back tens of seconds after a resume, so every wake turned into a suicide.
//    Here a dead socket only schedules a reconnect.
//
// 2. Rules must keep arriving even if the socket never works at all. pkg on
//    Node 18.5 is a peculiar runtime, and if the WebSocket upgrade fails for a
//    reason nobody has met yet, polling takes over. A child's PC that stops
//    enforcing because a transport was unavailable is the worst outcome there
//    is — worse than a minute of staleness.

import { WS_BASE_URL } from '../config.js'

const RECONNECT_MIN_MS = 2_000
const RECONNECT_MAX_MS = 60_000

// How long a socket may fail to establish before polling starts. Polling then
// keeps running alongside further reconnect attempts.
const FALLBACK_AFTER_FAILURES = 3
const POLL_INTERVAL_MS = 20_000

export function createLiveChannel({ getToken, onSnapshot, onPatch, poll, log }) {
  let socket = null
  let reconnectTimer = null
  let pollTimer = null
  let retryDelay = RECONNECT_MIN_MS
  let consecutiveFailures = 0
  let stopped = false
  let authenticated = false

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return
    const delay = retryDelay
    retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect().catch(err => log(`live channel connect threw: ${err.message}`))
    }, delay)
    // No unref(): this timer is the only thing keeping rule delivery alive.
  }

  function startPolling() {
    if (pollTimer || stopped || !poll) return
    log('live channel unavailable — falling back to polling')
    pollTimer = setInterval(() => {
      poll().catch(err => log(`poll failed: ${err.message}`))
    }, POLL_INTERVAL_MS)
    poll().catch(err => log(`poll failed: ${err.message}`))
  }

  function stopPolling() {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = null
    log('live channel restored — polling stopped')
  }

  // Loaded through a dynamic import rather than a top-level one, and the
  // result is cached. A missing or broken ws must degrade to polling, not stop
  // the agent from starting: a telemetry library that threw at module level
  // once made installs look successful while the service never ran at all.
  let wsModule = null
  async function loadWebSocket() {
    if (wsModule) return wsModule
    const mod = await import('ws')
    wsModule = mod.default ?? mod
    return wsModule
  }

  async function connect() {
    if (stopped || socket) return

    const token = getToken()
    if (!token) {
      // Not paired or not authenticated yet. The caller retries after it has
      // a token; polling covers the gap if it lasts.
      scheduleReconnect()
      return
    }

    let WebSocketImpl
    try {
      WebSocketImpl = await loadWebSocket()
    } catch (err) {
      log(`ws module unavailable (${err.message}) — polling instead`)
      startPolling()
      return
    }

    if (stopped) return

    try {
      socket = new WebSocketImpl(`${WS_BASE_URL}/ws/agent`, {
        handshakeTimeout: 15_000
      })
    } catch (err) {
      socket = null
      consecutiveFailures++
      log(`live channel connect failed: ${err.message}`)
      if (consecutiveFailures >= FALLBACK_AFTER_FAILURES) startPolling()
      scheduleReconnect()
      return
    }

    authenticated = false

    socket.on('open', () => {
      socket.send(JSON.stringify({ t: 'auth', token: getToken() }))
    })

    socket.on('message', (raw) => {
      let frame
      try {
        frame = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (frame.t === 'ready') {
        authenticated = true
        consecutiveFailures = 0
        retryDelay = RECONNECT_MIN_MS
        stopPolling()
        log('live channel connected')
        return
      }
      // The server lost its own database connection and may have missed
      // changes. Re-subscribing brings a fresh snapshot.
      if (frame.t === 'resync') {
        if (frame.ch) socket.send(JSON.stringify({ t: 'sub', ch: frame.ch }))
        return
      }
      if (frame.t === 'snap') {
        onSnapshot?.(frame.ch, frame.data ?? [])
        return
      }
      if (frame.t === 'patch') {
        onPatch?.(frame.ch, frame.op, frame.data)
      }
    })

    socket.on('close', (code) => {
      const wasAuthenticated = authenticated
      socket = null
      authenticated = false
      if (stopped) return

      if (!wasAuthenticated) {
        consecutiveFailures++
        if (consecutiveFailures >= FALLBACK_AFTER_FAILURES) startPolling()
      }
      log(`live channel closed (${code})`)
      scheduleReconnect()
    })

    socket.on('error', (err) => {
      // 'close' always follows, and reconnection is handled there. Logged at
      // this level only because a connect error carries the reason and the
      // close event does not.
      log(`live channel error: ${err.message}`)
    })
  }

  return {
    start() {
      stopped = false
      connect().catch(err => log(`live channel connect threw: ${err.message}`))
    },
    stop() {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      if (socket) {
        const s = socket
        socket = null
        try { s.close() } catch { /* already closing */ }
      }
    },
    // Called after re-authentication: the old socket is carrying a token the
    // server has stopped accepting.
    reconnectNow() {
      if (socket) {
        const s = socket
        socket = null
        try { s.terminate() } catch { /* already gone */ }
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      retryDelay = RECONNECT_MIN_MS
      connect().catch(err => log(`live channel connect threw: ${err.message}`))
    },
    get connected() {
      return authenticated
    }
  }
}
