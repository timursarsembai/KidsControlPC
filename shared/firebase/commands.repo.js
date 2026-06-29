import { httpsCallable } from 'firebase/functions'
import { functions } from './config.js'

export async function sendDeviceCommand(ownerUid, deviceId, commandData) {
  if (!deviceId) throw new Error('No device selected')
  const fn = httpsCallable(functions, 'sendDeviceCommand')
  // Strip client-side uploadToken — server fetches it from the device doc.
  const { uploadToken, ...cleanData } = commandData
  const result = await fn({ ownerUid, deviceId, ...cleanData })
  return result.data
}
