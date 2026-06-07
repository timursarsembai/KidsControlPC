import { doc, onSnapshot, writeBatch } from 'firebase/firestore'
import { db } from './config'
import { appsCol } from './paths.js'

export function subscribeToInstalledApps(uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return onSnapshot(appsCol(uid, deviceId), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// Agent uses this to bulk-upload installed apps (called from agent, not parent UI).
export async function uploadInstalledApps(uid, deviceId, apps) {
  const col = appsCol(uid, deviceId)
  const chunks = []
  for (let i = 0; i < apps.length; i += 400) chunks.push(apps.slice(i, i + 400))

  for (const chunk of chunks) {
    const b = writeBatch(db)
    for (const app of chunk) {
      const ref = doc(col, app.id)
      b.set(ref, { name: app.name, path: app.path, publisher: app.publisher, version: app.version }, { merge: true })
    }
    await b.commit()
  }
}
