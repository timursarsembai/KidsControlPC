import { httpsCallable } from 'firebase/functions'
import { functions } from './config.js'

export async function createPairingCode() {
  const fn = httpsCallable(functions, 'createPairingCode')
  const result = await fn()
  return result.data  // { code, expiresAt }
}

// Generates a pairing code for reinstalling the agent on an existing device
// (e.g. replacing a laptop) without losing its rules — pairDevice writes into
// the same deviceId instead of creating a new device.
export async function createRepairPairingCode(ownerUid, deviceId) {
  const fn = httpsCallable(functions, 'createRepairPairingCode')
  const result = await fn({ ownerUid, deviceId })
  return result.data  // { code, expiresAt }
}
