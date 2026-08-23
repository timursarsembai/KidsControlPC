// Same signatures as shared/firebase/pairing.repo.js.

import { api } from './client.js'

export async function createPairingCode() {
  return api.post('/pairing/codes')
}

// Re-pairing an existing device — replacing a laptop, reinstalling Windows —
// without losing its rules and history.
export async function createRepairPairingCode(_ownerUid, deviceId) {
  return api.post('/pairing/codes/repair', { deviceId })
}
