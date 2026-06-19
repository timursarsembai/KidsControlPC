import { deleteObject, getDownloadURL, getStorage, ref as storageRef } from 'firebase/storage'
import { deleteDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { screenshotDoc, screenshotsCol } from './paths.js'

export function subscribeToScreenshots(uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return onSnapshot(query(screenshotsCol(uid, deviceId), orderBy('createdAt', 'desc')), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function deleteScreenshot(uid, deviceId, screenshot) {
  if (!screenshot?.id) return
  const storage = getStorage()
  for (const path of [screenshot.storagePath, screenshot.thumbnailStoragePath].filter(Boolean)) {
    try {
      await deleteObject(storageRef(storage, path))
    } catch {}
  }
  await deleteDoc(screenshotDoc(uid, deviceId, screenshot.id))
}

export async function markScreenshotDownloaded(uid, deviceId, screenshotId) {
  if (!screenshotId) return
  await updateDoc(screenshotDoc(uid, deviceId, screenshotId), {
    downloadedAt: serverTimestamp()
  })
}

export async function getScreenshotDownloadURL(screenshot) {
  const path = screenshot?.thumbnailStoragePath || screenshot?.storagePath
  if (!path) return null
  return await getDownloadURL(storageRef(getStorage(), path))
}

export async function getScreenshotFullDownloadURL(screenshot) {
  if (!screenshot?.storagePath) return null
  return await getDownloadURL(storageRef(getStorage(), screenshot.storagePath))
}
