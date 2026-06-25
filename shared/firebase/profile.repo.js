import { getDoc, setDoc } from 'firebase/firestore'
import { profileDoc } from './paths.js'
import { serverTimestamp } from './timestamps.js'

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
      ownerUid: uid
    }
    await setDoc(ref, profile)
    return profile
  }

  const profile = snap.data()
  const updates = {}
  if (!profile.email && email) updates.email = email
  if (!profile.ownerUid) updates.ownerUid = uid
  if (!profile.role) updates.role = updates.ownerUid === uid ? 'owner' : 'parent'

  if (Object.keys(updates).length > 0) {
    await setDoc(ref, updates, { merge: true })
  }

  return { ...profile, ...updates }
}
