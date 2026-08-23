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
