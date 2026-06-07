import { onSnapshot, orderBy, query, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from './config.js'
import { alertDoc, alertsCol } from './paths.js'

export function subscribeToAlerts(uid, callback) {
  return onSnapshot(
    query(alertsCol(uid), orderBy('timestamp', 'desc')),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  )
}

export async function acknowledgeAlert(uid, alertId) {
  await updateDoc(alertDoc(uid, alertId), { acknowledged: true })
}

export async function acknowledgeAllAlerts(uid, alertIds) {
  if (!alertIds || alertIds.length === 0) return
  const chunks = []
  for (let i = 0; i < alertIds.length; i += 400) chunks.push(alertIds.slice(i, i + 400))

  for (const chunk of chunks) {
    const b = writeBatch(db)
    for (const id of chunk) {
      b.update(alertDoc(uid, id), { acknowledged: true })
    }
    await b.commit()
  }
}
