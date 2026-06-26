import { getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { profileDoc } from './paths.js'
import { serverTimestamp } from './timestamps.js'

const DEFAULT_QUOTA_BYTES = 1 * 1024 * 1024 * 1024  // 1 ГБ

export function subscribeToProfile(ownerUid, callback) {
  return onSnapshot(profileDoc(ownerUid), (snap) => {
    callback(snap.exists() ? snap.data() : {})
  })
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
  if (profile.storageUsedBytes === undefined) updates.storageUsedBytes = 0
  if (profile.storageQuotaBytes === undefined) updates.storageQuotaBytes = DEFAULT_QUOTA_BYTES

  if (Object.keys(updates).length > 0) {
    await setDoc(ref, updates, { merge: true })
  }

  return { ...profile, ...updates }
}
