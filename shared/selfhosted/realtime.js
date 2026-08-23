// The socket that replaces onSnapshot: one connection per process, channels
// multiplexed over it, callbacks that receive the whole collection.
//
// Reconnection is unconditional and unlimited. A parent's laptop sleeps, a
// child's PC comes back from Modern Standby with its network tens of seconds
// behind — a client that gives up after N attempts is a client that silently
// stops showing what is happening.

import { applyFrame, emptyState, toArray } from './channelState.js'
import { refreshSession } from './client.js'
import { WS_BASE_URL } from './config.js'
import { getAccessToken, onTokensChanged } from './tokens.js'

const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

// Close codes the server uses. 4002 means the token was refused — usually
// because it expired while the socket was open, which a refresh fixes.
const CLOSE_BAD_TOKEN = 4002

export function createRealtimeClient({ path = '/ws', tokenProvider = getAccessToken } = {}) {
  const channels = new Map()   // channel -> { state, listeners:Set }
  let socket = null
  let reconnectTimer = null
  let retryDelay = RECONNECT_MIN_MS
  let closed = false
  let authenticated = false

  function send(message) {
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify(message))
      return true
    }
    return false
  }

  function notify(channel, entry) {
    const items = toArray(entry.state)
    for (const listener of entry.listeners) {
      try {
        listener(items)
      } catch (err) {
        // A throwing listener is a bug in a panel component. It must not stop
        // the other subscribers of the same channel from being updated.
        console.error(`[realtime] listener for ${channel} threw:`, err)
      }
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return
    const delay = retryDelay
    retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function connect() {
    if (closed || socket) return
    const token = tokenProvider()
    // No session yet. Not an error: the panel mounts before the parent logs
    // in, and connecting will be retried when a token appears.
    if (!token) return

    const Socket = globalThis.WebSocket
    if (!Socket) {
      console.error('[realtime] no WebSocket implementation available')
      return
    }

    socket = new Socket(`${WS_BASE_URL}${path}`)
    authenticated = false

    socket.onopen = () => {
      send({ t: 'auth', token: tokenProvider() })
    }

    socket.onmessage = (event) => {
      let frame
      try {
        frame = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
      } catch {
        return
      }

      if (frame.t === 'ready') {
        authenticated = true
        retryDelay = RECONNECT_MIN_MS
        // Re-subscribe to everything: a new socket knows nothing about what
        // this client was watching, and each subscribe brings a fresh
        // snapshot, which is exactly what is needed after a gap.
        for (const channel of channels.keys()) send({ t: 'sub', ch: channel })
        return
      }

      if (frame.t === 'resync') {
        // The server lost its own connection to the database and may have
        // missed changes. Ask for the channel again to get a clean snapshot.
        if (frame.ch) send({ t: 'sub', ch: frame.ch })
        return
      }

      if (frame.t === 'error') {
        console.warn(`[realtime] channel ${frame.ch} refused: ${frame.code}`)
        return
      }

      const entry = channels.get(frame.ch)
      if (!entry) return
      if (applyFrame(entry.state, frame)) notify(frame.ch, entry)
    }

    socket.onclose = async (event) => {
      socket = null
      const wasAuthenticated = authenticated
      authenticated = false

      if (closed) return

      // An expired token closes the socket the moment it is presented. Refresh
      // once and reconnect immediately rather than backing off — the parent is
      // looking at a screen that has stopped updating.
      if (event?.code === CLOSE_BAD_TOKEN && !wasAuthenticated) {
        const refreshed = await refreshSession()
        if (refreshed) {
          retryDelay = RECONNECT_MIN_MS
          connect()
          return
        }
      }
      scheduleReconnect()
    }

    socket.onerror = () => {
      // onclose always follows; reconnection is handled there.
    }
  }

  // Reconnect as soon as a session appears, and drop the socket when it ends.
  const stopWatchingTokens = onTokensChanged((signedIn) => {
    if (signedIn) {
      retryDelay = RECONNECT_MIN_MS
      connect()
    } else if (socket) {
      const s = socket
      socket = null
      try { s.close() } catch { /* already closing */ }
    }
  })

  return {
    /**
     * Subscribes to a channel. The callback receives the entire collection,
     * the way onSnapshot did, and is called again on every change.
     *
     * @returns {() => void} unsubscribe
     */
    subscribe(channel, listener) {
      let entry = channels.get(channel)
      if (!entry) {
        entry = { state: emptyState(), listeners: new Set() }
        channels.set(channel, entry)
        if (!send({ t: 'sub', ch: channel })) connect()
      } else if (entry.state.ready) {
        // Another component is already watching this channel — hand the new
        // subscriber what we have instead of making it wait for the next
        // change to arrive.
        try {
          listener(toArray(entry.state))
        } catch (err) {
          console.error(`[realtime] listener for ${channel} threw:`, err)
        }
      }
      entry.listeners.add(listener)

      return () => {
        const current = channels.get(channel)
        if (!current) return
        current.listeners.delete(listener)
        if (current.listeners.size === 0) {
          channels.delete(channel)
          send({ t: 'unsub', ch: channel })
        }
      }
    },

    // For tests and for a clean shutdown in Electron.
    close() {
      closed = true
      stopWatchingTokens()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      channels.clear()
      if (socket) {
        const s = socket
        socket = null
        try { s.close() } catch { /* already closing */ }
      }
    },

    get connected() {
      return authenticated
    }
  }
}

// One socket for the whole panel. Created lazily so importing a repository
// module does not open a connection on its own.
let shared = null

export function realtime() {
  if (!shared) shared = createRealtimeClient()
  return shared
}
