// Same signatures as shared/firebase/devices.repo.js, so callers do not care
// which backend is behind them.
//
// The uid argument is kept and ignored: the server takes the owner from the
// access token, and it must — a client that could name the account it is
// asking about could name someone else's.

import { api } from './client.js'
import { realtime } from './realtime.js'
import { withTimestamps } from './timestamp.js'

function byPairedAtDesc(a, b) {
  return new Date(b.pairedAt ?? 0) - new Date(a.pairedAt ?? 0)
}

export function subscribeToDevices(_uid, callback) {
  return realtime().subscribe('devices', (devices) => {
    const shaped = devices.map(device => withTimestamps({ ...device }, ['lastSeen', 'pairedAt']))
    callback(shaped.sort(byPairedAtDesc))
  })
}

export async function updateDeviceAlias(_uid, deviceId, alias) {
  await api.patch(`/devices/${deviceId}`, { alias })
}

export async function removeDevice(_uid, deviceId) {
  await api.delete(`/devices/${deviceId}`)
}

/**
 * Writes device settings — isLocked, lockMessage, forceUpdateRequestedAtMs and
 * whatever else the panel and the agent agree on.
 *
 * They go into a jsonb column server-side but come back spread at the top
 * level of the device, which is where the Firestore document had them and
 * where every caller already reads them from.
 */
export async function updateDeviceSettings(_uid, deviceId, settings) {
  await api.patch(`/devices/${deviceId}`, { settings })
}
