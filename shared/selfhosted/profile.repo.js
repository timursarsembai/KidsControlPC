// Same signatures as shared/firebase/profile.repo.js, minus what the
// self-hosted backend does not have yet.

import { api } from './client.js'

export const DEFAULT_QUOTA_BYTES = 100 * 1024 * 1024  // 100 МБ (Free план)

/**
 * The profile has no live channel, deliberately: it changes when the parent
 * changes it, and pushing that back to the same screen that just sent it buys
 * nothing. The callback fires once with the current profile, exactly as the
 * Firestore version did on its first snapshot.
 */
export function subscribeToProfile(_ownerUid, callback) {
  let cancelled = false

  api.get('/me')
    .then(profile => { if (!cancelled) callback(profile) })
    // An empty object is what the Firestore version passed when the document
    // did not exist; callers already handle it.
    .catch(() => { if (!cancelled) callback({}) })

  return () => { cancelled = true }
}

// Registration creates the profile server-side, so there is nothing to
// initialise. Kept because callers call it on every sign-in and expect the
// profile back.
export async function initUserProfile(_uid, _email) {
  return api.get('/me')
}

// Account-wide emergency unlock. No live channel for it: the parent flipping
// the switch is the only thing that changes it, and the agent polls the same
// value through its own device config.
export function subscribeToPauseAllRules(_ownerUid, callback) {
  let cancelled = false
  api.get('/me')
    .then(profile => { if (!cancelled) callback(Boolean(profile.pauseAllRules)) })
    .catch(() => { if (!cancelled) callback(false) })
  return () => { cancelled = true }
}

export async function setPauseAllRules(_ownerUid, paused) {
  await api.patch('/me', { pauseAllRules: paused })
}

export async function updateChatName(_uid, chatName) {
  await api.patch('/me', { chatName: chatName || '' })
}

// Deleting the account takes its devices, rules and history with it. The
// password is required again on purpose — a token left open on a shared
// computer must not be enough to erase a family's account.
export async function deleteAccount(password) {
  await api.delete('/me', { body: { password } })
}
