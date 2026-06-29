import { httpsCallable } from 'firebase/functions'
import { functions } from './config.js'

export async function createPairingCode() {
  const fn = httpsCallable(functions, 'createPairingCode')
  const result = await fn()
  return result.data  // { code, expiresAt }
}
