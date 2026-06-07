import { setDoc } from 'firebase/firestore'
import { pairingCodeDoc } from './paths.js'
import { serverTimestamp } from './timestamps.js'

export async function createPairingCode(uid, code) {
  await setDoc(pairingCodeDoc(code), {
    parentUid: uid,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    used: false
  })
}
