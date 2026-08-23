// Token storage for the parent session.
//
// localStorage, not a cookie: the API is on another origin, tokens travel in
// the Authorization header, and a cookie would have to be third-party — which
// browsers are in the middle of taking away.
//
// The refresh token being reachable from JavaScript is the known cost. It buys
// a session that survives a reload, and the server limits the damage: every
// refresh rotates the token, and a token presented twice kills every session
// of that account.

const ACCESS_KEY = 'kidscontrol.accessToken'
const REFRESH_KEY = 'kidscontrol.refreshToken'

// Electron's main process and Node have no localStorage. Falling back to a
// module-level object keeps the same API working there — it just does not
// survive a restart, which is correct for a process that has no user session.
const memory = new Map()

function store() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // Access to localStorage throws in some sandboxed frames.
  }
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k)
  }
}

const listeners = new Set()

export function getAccessToken() {
  return store().getItem(ACCESS_KEY)
}

export function getRefreshToken() {
  return store().getItem(REFRESH_KEY)
}

export function setTokens({ accessToken, refreshToken }) {
  const s = store()
  if (accessToken) s.setItem(ACCESS_KEY, accessToken)
  if (refreshToken) s.setItem(REFRESH_KEY, refreshToken)
  notify()
}

export function clearTokens() {
  const s = store()
  s.removeItem(ACCESS_KEY)
  s.removeItem(REFRESH_KEY)
  notify()
}

// Lets the auth layer and the socket react to a session appearing or ending
// without polling for it.
export function onTokensChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  const signedIn = Boolean(getAccessToken())
  for (const listener of listeners) {
    try {
      listener(signedIn)
    } catch {
      // A broken listener must not stop the others from being told.
    }
  }
}
