// Same signature as shared/firebase/commands.repo.js.

import { api } from './client.js'
import { realtime } from './realtime.js'

export async function sendDeviceCommand(_ownerUid, deviceId, commandData) {
  if (!deviceId) throw new Error('No device selected')

  // uploadToken is stripped exactly as the Firebase version stripped it. On
  // this backend it does not exist at all: a command is addressed to the
  // device id inside a signed token, not to a shared secret.
  const { uploadToken, ...clean } = commandData
  return api.post(`/devices/${deviceId}/commands`, clean)
}

// Lets the panel follow a command it just sent — whether the child's PC picked
// it up and what came of it.
export function subscribeToCommands(_ownerUid, deviceId, callback) {
  if (!deviceId) return () => {}
  return realtime().subscribe(`commands:${deviceId}`, callback)
}
