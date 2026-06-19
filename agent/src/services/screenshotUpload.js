import fs from 'fs'
import { randomBytes } from 'crypto'
import { collection, addDoc, serverTimestamp, query, where, getDocs, deleteDoc, limit, updateDoc, doc } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes, deleteObject } from 'firebase/storage'
import { db } from '../network/firebaseSync.js'
import { PAIRING_FILE } from '../config.js'
import { withOperationTimeout } from './operationTimeout.js'

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const SCREENSHOT_TTL_MS = 3 * 24 * 60 * 60 * 1000
const INLINE_SCREENSHOT_MAX_BYTES = 900 * 1024
const UPLOAD_TOKEN_TIMEOUT_MS = 15000
const STORAGE_UPLOAD_TIMEOUT_MS = 15000
const FIRESTORE_SCREENSHOT_TIMEOUT_MS = 15000

let lastCleanupAt = 0
let uploadToken = null

function readPairingFile() {
  try {
    if (!fs.existsSync(PAIRING_FILE)) return null
    return JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf8'))
  } catch {
    return null
  }
}

function writePairingFile(pairing) {
  fs.writeFileSync(PAIRING_FILE, JSON.stringify(pairing, null, 2), 'utf8')
}

export async function ensureUploadToken(parentUid, deviceId) {
  if (uploadToken) return uploadToken

  const pairing = readPairingFile() || {}
  uploadToken = pairing.screenshotUploadToken
  if (!uploadToken) {
    uploadToken = randomBytes(32).toString('hex')
    writePairingFile({ ...pairing, screenshotUploadToken: uploadToken })
  }

  await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), {
    screenshotUploadToken: uploadToken
  })

  return uploadToken
}

async function saveScreenshotDoc(fileInfo, source, token, parentUid, deviceId, extra = {}) {
  const screenshotsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'screenshots')
  const docRef = await withOperationTimeout(addDoc(screenshotsRef, {
    source,
    status: 'ready',
    uploadToken: token,
    size: fileInfo.size,
    quality: fileInfo.quality,
    maxWidth: fileInfo.maxWidth,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + SCREENSHOT_TTL_MS),
    ...extra
  }), FIRESTORE_SCREENSHOT_TIMEOUT_MS, 'Screenshot metadata write timed out', 'screenshot_metadata_timeout')

  return { screenshotId: docRef.id, ...extra }
}

async function uploadScreenshotToStorage(fileInfo, source, token, parentUid, deviceId) {
  const storage = getStorage()
  const storagePath = `users/${parentUid}/devices/${deviceId}/screenshots/${fileInfo.requestId}.jpg`
  const ref = storageRef(storage, storagePath)
  const bytes = fs.readFileSync(fileInfo.outputPath)

  await withOperationTimeout(
    uploadBytes(ref, bytes, {
      contentType: 'image/jpeg',
      customMetadata: {
        source,
        deviceId,
        requestId: fileInfo.requestId,
        uploadToken: token
      }
    }),
    STORAGE_UPLOAD_TIMEOUT_MS,
    `Storage screenshot upload timed out after ${STORAGE_UPLOAD_TIMEOUT_MS / 1000}s`,
    'screenshot_storage_timeout'
  )

  return await saveScreenshotDoc(fileInfo, source, token, parentUid, deviceId, {
    storagePath,
    delivery: 'storage'
  })
}

async function saveInlineScreenshot(fileInfo, source, token, parentUid, deviceId) {
  if (fileInfo.size > INLINE_SCREENSHOT_MAX_BYTES) {
    throw new Error(`Screenshot is too large for inline fallback: ${fileInfo.size} bytes`)
  }

  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(fileInfo.outputPath).toString('base64')}`
  return await saveScreenshotDoc(fileInfo, source, token, parentUid, deviceId, {
    dataUrl,
    delivery: 'firestore_inline'
  })
}

export async function uploadScreenshot(fileInfo, source, parentUid, deviceId, log) {
  const token = await withOperationTimeout(
    ensureUploadToken(parentUid, deviceId),
    UPLOAD_TOKEN_TIMEOUT_MS,
    'Screenshot upload token setup timed out',
    'screenshot_token_timeout'
  )
  try {
    return await uploadScreenshotToStorage(fileInfo, source, token, parentUid, deviceId)
  } catch (err) {
    log(`Storage upload failed, using inline fallback: ${err.message}`)
    return await saveInlineScreenshot(fileInfo, source, token, parentUid, deviceId)
  }
}

export async function cleanupExpiredScreenshots(parentUid, deviceId, log) {
  if (!parentUid || !deviceId) return
  const now = Date.now()
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now

  const screenshotsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'screenshots')
  const expiredQuery = query(screenshotsRef, where('expiresAt', '<=', new Date()), limit(20))
  const snap = await getDocs(expiredQuery)
  const storage = getStorage()

  for (const docSnap of snap.docs) {
    const data = docSnap.data()
    if (data.storagePath) {
      try {
        await deleteObject(storageRef(storage, data.storagePath))
      } catch {}
    }
    await deleteDoc(docSnap.ref)
  }

  if (!snap.empty) log(`Cleaned up ${snap.size} expired screenshots`)
}
