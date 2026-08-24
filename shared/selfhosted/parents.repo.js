// Same signatures as shared/firebase/parents.repo.js.
//
// There is no live channel for this: the list changes when the owner invites
// or removes someone, which is the same screen that is looking at it. Instead
// of polling, every mutation refreshes the subscribers directly — the list is
// a handful of rows and the request is cheap.

import { api } from './client.js'

const invitationListeners = new Set()
const accessListeners = new Set()

let lastAccess = []
let lastInvitations = []

async function refresh() {
  try {
    const data = await api.get('/parents')
    lastAccess = data.access ?? []
    lastInvitations = data.invitations ?? []
  } catch {
    // Keeping the previous list rather than blanking it: a failed refresh is
    // usually a dropped connection, and showing "нет доступов" would read as
    // "someone removed them".
    return
  }
  for (const listener of accessListeners) {
    try { listener(lastAccess) } catch (err) { console.error('[parents]', err) }
  }
  for (const listener of invitationListeners) {
    try { listener(lastInvitations) } catch (err) { console.error('[parents]', err) }
  }
}

function subscribe(set, listener, snapshot) {
  set.add(listener)
  listener(snapshot)
  refresh()
  return () => set.delete(listener)
}

export function subscribeToParentInvitations(_ownerUid, callback) {
  return subscribe(invitationListeners, callback, lastInvitations)
}

export function subscribeToParentAccess(_ownerUid, callback) {
  return subscribe(accessListeners, callback, lastAccess)
}

export async function createParentInvitation(email) {
  const invitation = await api.post('/parents/invitations', { email })
  await refresh()
  return invitation
}

// Read before signing in: the person following the link may not have an
// account session yet, and the token in the link is what proves they were
// invited.
export async function getParentInvitation(invitationId, token) {
  return api.get(`/parents/invitations/${invitationId}?token=${encodeURIComponent(token)}`, { auth: false })
}

export async function acceptParentInvitation(invitationId, token) {
  const result = await api.post(`/parents/invitations/${invitationId}/accept`, { token })
  await refresh()
  return result
}

export async function declineParentInvitation(invitationId, token) {
  return api.post(`/parents/invitations/${invitationId}/decline`, { token })
}

export async function revokeParentAccess(parentUid) {
  await api.delete(`/parents/${parentUid}`)
  await refresh()
}
