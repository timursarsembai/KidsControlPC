import { deleteObject, getDownloadURL, getStorage, ref as storageRef } from 'firebase/storage'
import { deleteDoc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { screenshotDoc, screenshotsCol } from './paths.js'

export function subscribeToScreenshots(uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return onSnapshot(query(screenshotsCol(uid, deviceId), orderBy('createdAt', 'desc')), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function deleteScreenshot(uid, deviceId, screenshot) {
  if (!screenshot?.id) return
  if (screenshot.storagePath) {
    try {
      await deleteObject(storageRef(getStorage(), screenshot.storagePath))
    } catch {}
  }
  await deleteDoc(screenshotDoc(uid, deviceId, screenshot.id))
}

export async function getScreenshotDownloadURL(screenshot) {
  if (!screenshot?.storagePath) return null
  return await getDownloadURL(storageRef(getStorage(), screenshot.storagePath))
}
