// Sign-in for the self-hosted backend.
//
// The shape is not Firebase's: there is no auth.currentUser to read
// synchronously, because there is no SDK holding a session object. What is
// kept is the part callers actually depend on — a subscription that fires with
// the current user and again whenever that changes.

import { api } from './client.js'
import { deleteAccount as deleteProfileAccount } from './profile.repo.js'
import { clearTokens, getAccessToken, getRefreshToken, onTokensChanged, setTokens } from './tokens.js'

let currentUser = null
const listeners = new Set()

function setUser(user) {
  currentUser = user
  for (const listener of listeners) {
    try {
      listener(user)
    } catch (err) {
      console.error('[auth] listener threw:', err)
    }
  }
}

export function getCurrentUser() {
  return currentUser
}

/**
 * Stands in for onAuthStateChanged. Fires immediately with what is known now,
 * then on every sign-in and sign-out.
 *
 * @returns {() => void} unsubscribe
 */
export function onAuthChanged(listener) {
  listeners.add(listener)
  listener(currentUser)
  return () => listeners.delete(listener)
}

export async function register(email, password) {
  const session = await api.post('/auth/register', { email, password }, { auth: false })
  setTokens(session)
  setUser(session.user)
  return session.user
}

export async function login(email, password) {
  const session = await api.post('/auth/login', { email, password }, { auth: false })
  setTokens(session)
  setUser(session.user)
  return session.user
}

export async function logout() {
  // Read before clearing: the server needs this to revoke the session on its
  // side, and clearing first would leave it valid until it expired — thirty
  // days during which a copied token still works.
  const refreshToken = getRefreshToken()
  clearTokens()
  setUser(null)
  if (!refreshToken) return
  try {
    await api.post('/auth/logout', { refreshToken }, { auth: false })
  } catch {
    // The local session is already gone, which is what the parent asked for.
    // A server that cannot be reached will expire the token on its own.
  }
}

/**
 * Restores the session on start-up: a stored token means the parent was
 * signed in, but only the server can say whether it is still valid.
 */
export async function restoreSession() {
  if (!getAccessToken()) {
    setUser(null)
    return null
  }
  try {
    const profile = await api.get('/me')
    setUser({ id: profile.id, email: profile.email })
    return currentUser
  } catch (err) {
    // 401 after a failed refresh means the session is genuinely over. A
    // network error means we simply do not know — do not sign the parent out
    // over a dropped wifi connection.
    if (err.status === 401) {
      clearTokens()
      setUser(null)
    }
    return null
  }
}

// Keeps the user in step with tokens cleared elsewhere, e.g. by the HTTP
// client after a refresh token was rejected.
onTokensChanged((signedIn) => {
  if (!signedIn && currentUser) setUser(null)
})

// Deleting the account ends the session with it: the tokens now point at
// nothing, and leaving them in storage would show a signed-in shell over an
// account that is gone.
export async function deleteAccount(password) {
  await deleteProfileAccount(password)
  clearTokens()
  setUser(null)
}

/**
 * Changes the password and keeps the session alive.
 *
 * The server revokes every other session — including any copy of the token
 * someone else might hold — and hands back a fresh pair for this one, which is
 * why the response is stored the same way a sign-in is.
 */
export async function changePassword(currentPassword, newPassword) {
  const session = await api.post('/auth/change-password', { currentPassword, newPassword })
  setTokens(session)
  setUser(session.user)
  return session.user
}
