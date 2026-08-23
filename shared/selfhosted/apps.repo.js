// Same signatures as shared/firebase/apps.repo.js.

import { api } from './client.js'
import { realtime } from './realtime.js'

export function subscribeToInstalledApps(_uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return realtime().subscribe(`apps:${deviceId}`, callback)
}

// Called by the agent, not by the parent panel. Chunked the same way the
// Firestore version was: a Windows machine reports a few hundred programs, and
// one request carrying all of them from a home connection is a request that
// times out halfway and leaves nothing.
export async function uploadInstalledApps(_uid, deviceId, apps) {
  for (let i = 0; i < apps.length; i += 400) {
    await api.post('/agent/apps', { apps: apps.slice(i, i + 400) })
  }
}
