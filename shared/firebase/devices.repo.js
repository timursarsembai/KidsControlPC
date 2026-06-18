import { deleteDoc, onSnapshot, updateDoc } from 'firebase/firestore'
import { deviceCol, deviceDoc } from './paths.js'

export function subscribeToDevices(uid, callback) {
  return onSnapshot(deviceCol(uid), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function updateDeviceAlias(uid, deviceId, alias) {
  await updateDoc(deviceDoc(uid, deviceId), { alias })
}

export async function removeDevice(uid, deviceId) {
  await deleteDoc(deviceDoc(uid, deviceId))
}

export async function updateDeviceSettings(uid, deviceId, settings) {
  await updateDoc(deviceDoc(uid, deviceId), settings)
}
