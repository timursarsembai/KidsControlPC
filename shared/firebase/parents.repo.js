import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './config.js'

const parentInvitationsCol = (ownerUid) => collection(db, 'users', ownerUid, 'parentInvitations')
const parentAccessCol = (ownerUid) => collection(db, 'users', ownerUid, 'parentAccess')

export function subscribeToParentInvitations(ownerUid, callback) {
  if (!ownerUid) return () => {}
  return onSnapshot(query(parentInvitationsCol(ownerUid), orderBy('createdAt', 'desc')), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export function subscribeToParentAccess(ownerUid, callback) {
  if (!ownerUid) return () => {}
  return onSnapshot(query(parentAccessCol(ownerUid), orderBy('acceptedAt', 'desc')), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function createParentInvitation(email) {
  const createInvitation = httpsCallable(functions, 'createParentInvitation')
  const result = await createInvitation({ email })
  return result.data
}

export async function getParentInvitation(invitationId, token) {
  const getInvitation = httpsCallable(functions, 'getParentInvitation')
  const result = await getInvitation({ invitationId, token })
  return result.data
}

export async function acceptParentInvitation(invitationId, token) {
  const acceptInvitation = httpsCallable(functions, 'acceptParentInvitation')
  const result = await acceptInvitation({ invitationId, token })
  return result.data
}

export async function declineParentInvitation(invitationId, token) {
  const declineInvitation = httpsCallable(functions, 'declineParentInvitation')
  const result = await declineInvitation({ invitationId, token })
  return result.data
}
