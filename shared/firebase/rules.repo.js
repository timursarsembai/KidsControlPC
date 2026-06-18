import { addDoc, deleteDoc, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore'
import { ruleDoc, rulesCol } from './paths.js'
import { serverTimestamp } from './timestamps.js'

export function subscribeToRules(uid, deviceId, callback) {
  if (!deviceId) return () => {}
  const q = query(rulesCol(uid, deviceId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function addRule(uid, deviceId, ruleData) {
  const ref = await addDoc(rulesCol(uid, deviceId), {
    ...ruleData,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
  return ref.id
}

export async function updateRule(uid, deviceId, ruleId, updates) {
  await updateDoc(ruleDoc(uid, deviceId, ruleId), {
    ...updates,
    updatedAt: serverTimestamp()
  })
}

export async function savePomodoroRule(uid, deviceId, data) {
  await setDoc(ruleDoc(uid, deviceId, 'global_pomodoro'), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function deleteRule(uid, deviceId, ruleId) {
  await deleteDoc(ruleDoc(uid, deviceId, ruleId))
}
