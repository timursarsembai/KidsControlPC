// Same signatures as shared/firebase/pairing.repo.js.

import { api } from './client.js'

// childId — профиль, которому достанется устройство. Без него устройство
// привяжется без профиля.
export async function createPairingCode(childId = null) {
  return api.post('/pairing/codes', childId ? { childId } : {})
}

// Re-pairing an existing device — replacing a laptop, reinstalling Windows —
// without losing its rules and history.
export async function createRepairPairingCode(_ownerUid, deviceId) {
  return api.post('/pairing/codes/repair', { deviceId })
}
