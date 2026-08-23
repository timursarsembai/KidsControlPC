// Same signatures as shared/firebase/alerts.repo.js.

import { api } from './client.js'
import { realtime } from './realtime.js'

function byTimestampDesc(a, b) {
  return new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0)
}

export function subscribeToAlerts(_uid, callback) {
  return realtime().subscribe('alerts', (alerts) => {
    callback([...alerts].sort(byTimestampDesc))
  })
}

export async function acknowledgeAlert(_uid, alertId) {
  await api.post(`/alerts/${alertId}/ack`)
}

// The Firestore version chunked this into batches of 400 because a write batch
// could hold no more. Here it is one statement server-side; the ids are still
// sent so an alert that arrived while the parent was reading does not get
// marked as seen along with the ones they actually saw.
export async function acknowledgeAllAlerts(_uid, alertIds) {
  if (!alertIds || alertIds.length === 0) return
  await api.post('/alerts/ack-all', { ids: alertIds })
}
