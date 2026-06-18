import { getDoc, setDoc } from 'firebase/firestore'
import { profileDoc } from './paths.js'
import { serverTimestamp } from './timestamps.js'

export async function initUserProfile(uid, email) {
  const ref = profileDoc(uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, { email, createdAt: serverTimestamp(), plan: 'free' })
  }
}
