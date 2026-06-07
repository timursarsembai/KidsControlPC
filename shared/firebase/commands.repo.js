import { addDoc } from 'firebase/firestore'
import { commandsCol } from './paths.js'
import { serverTimestamp } from './timestamps.js'

export async function sendDeviceCommand(uid, deviceId, commandData) {
  if (!deviceId) throw new Error('No device selected')
  return await addDoc(commandsCol(uid, deviceId), {
    ...commandData,
    status: 'pending',
    timestamp: serverTimestamp()
  })
}
