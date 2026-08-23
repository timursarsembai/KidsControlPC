import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from './config.js'
import { profileDoc } from './paths.js'
import { serverTimestamp } from './timestamps.js'

export const DEFAULT_QUOTA_BYTES = 100 * 1024 * 1024  // 100 МБ (Free план)

export function subscribeToProfile(ownerUid, callback) {
  return onSnapshot(profileDoc(ownerUid), (snap) => {
    callback(snap.exists() ? snap.data() : {})
  })
}

export async function recalcStorageUsed(ownerUid, actualBytes) {
  await setDoc(profileDoc(ownerUid), { storageUsedBytes: actualBytes }, { merge: true })
}

// Parent's display name shown to children in the chat (e.g. "Папа", "Мама").
export async function updateChatName(uid, chatName) {
  await setDoc(profileDoc(uid), { chatName: chatName || '' }, { merge: true })
}

export async function initUserProfile(uid, email) {
  const ref = profileDoc(uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    const profile = {
      email,
      createdAt: serverTimestamp(),
      plan: 'free',
      role: 'owner',
      ownerUid: uid,
      storageUsedBytes: 0,
      storageQuotaBytes: DEFAULT_QUOTA_BYTES
    }
    await setDoc(ref, profile)
    return profile
  }

  const profile = snap.data()
  const updates = {}
  if (!profile.email && email) updates.email = email
  if (!profile.ownerUid) updates.ownerUid = uid
  if (!profile.role) updates.role = updates.ownerUid === uid ? 'owner' : 'parent'
  if (profile.storageUsedBytes === undefined || profile.storageUsedBytes < 0) updates.storageUsedBytes = 0
  if (profile.storageQuotaBytes === undefined) updates.storageQuotaBytes = DEFAULT_QUOTA_BYTES
  // Migrate old default (1 GB) to new free plan default (100 MB)
  if (profile.storageQuotaBytes === 1 * 1024 * 1024 * 1024 && profile.plan === 'free') {
    updates.storageQuotaBytes = DEFAULT_QUOTA_BYTES
  }

  if (Object.keys(updates).length > 0) {
    await setDoc(ref, updates, { merge: true })
  }

  return { ...profile, ...updates }
}

// Account-wide emergency unlock. Lives in the root users/{uid} document rather
// than the profile subdocument because that is where the agent reads it from.
export function subscribeToPauseAllRules(ownerUid, callback) {
  if (!ownerUid) return () => {}
  return onSnapshot(doc(db, 'users', ownerUid), (snap) => {
    callback(snap.exists() ? !!snap.data().pauseAllRules : false)
  })
}

export async function setPauseAllRules(ownerUid, paused) {
  await setDoc(doc(db, 'users', ownerUid), { pauseAllRules: paused }, { merge: true })
}
