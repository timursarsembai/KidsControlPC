/**
 * Firebase Firestore service layer — v2 (multi-device)
 * All rules are per-device: users/{uid}/devices/{deviceId}/rules/
 * Installed apps come from agent: users/{uid}/devices/{deviceId}/installedApps/
 */
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp as fsServerTimestamp, writeBatch
} from 'firebase/firestore'
import { getStorage, ref as storageRef, deleteObject, getDownloadURL } from 'firebase/storage'
import { db } from './config'

export const serverTimestamp = fsServerTimestamp


// ─── Collection helpers ──────────────────────────────────────────────────────

const deviceCol      = (uid)              => collection(db, 'users', uid, 'devices')
const deviceDoc      = (uid, devId)       => doc(db, 'users', uid, 'devices', devId)
const rulesCol       = (uid, devId)       => collection(db, 'users', uid, 'devices', devId, 'rules')
const ruleDoc        = (uid, devId, rId)  => doc(db, 'users', uid, 'devices', devId, 'rules', rId)
const appsCol        = (uid, devId)       => collection(db, 'users', uid, 'devices', devId, 'installedApps')
const commandsCol    = (uid, devId)       => collection(db, 'users', uid, 'devices', devId, 'commands')
const screenshotsCol = (uid, devId)       => collection(db, 'users', uid, 'devices', devId, 'screenshots')
const alertsCol      = (uid)              => collection(db, 'users', uid, 'alerts')
const pairingCol     = (uid)              => collection(db, 'users', uid, 'pairingCodes')

// ─── Devices ─────────────────────────────────────────────────────────────────

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

// ─── Rules (per device) ───────────────────────────────────────────────────────

export function subscribeToRules(uid, deviceId, callback) {
  if (!deviceId) return () => {}
  const q = query(rulesCol(uid, deviceId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

export async function addRule(uid, deviceId, ruleData) {
  const ref = await addDoc(rulesCol(uid, deviceId), {
    ...ruleData,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
  return ref.id
}

export async function updateRule(uid, deviceId, ruleId, updates) {
  await updateDoc(ruleDoc(uid, deviceId, ruleId), {
    ...updates,
    updatedAt: serverTimestamp()
  })
}

export async function savePomodoroRule(uid, deviceId, data) {
  await setDoc(ruleDoc(uid, deviceId, 'global_pomodoro'), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function deleteRule(uid, deviceId, ruleId) {
  await deleteDoc(ruleDoc(uid, deviceId, ruleId))
}

// ─── Installed Apps (uploaded by child agent) ─────────────────────────────────

export function subscribeToInstalledApps(uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return onSnapshot(appsCol(uid, deviceId), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// Agent uses this to bulk-upload installed apps (called from agent, not parent UI)
export async function uploadInstalledApps(uid, deviceId, apps) {
  const col = appsCol(uid, deviceId)
  const batch = writeBatch(db)
  // Limit to 500 per batch (Firestore limit)
  const chunks = []
  for (let i = 0; i < apps.length; i += 400) chunks.push(apps.slice(i, i + 400))

  for (const chunk of chunks) {
    const b = writeBatch(db)
    for (const app of chunk) {
      const ref = doc(col, app.id)
      b.set(ref, { name: app.name, path: app.path, publisher: app.publisher, version: app.version }, { merge: true })
    }
    await b.commit()
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function sendDeviceCommand(uid, deviceId, commandData) {
  if (!deviceId) throw new Error('No device selected')
  return await addDoc(commandsCol(uid, deviceId), {
    ...commandData,
    status: 'pending',
    timestamp: serverTimestamp()
  })
}

export async function updateDeviceSettings(uid, deviceId, settings) {
  await updateDoc(doc(db, 'users', uid, 'devices', deviceId), settings)
}

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
  await deleteDoc(doc(db, 'users', uid, 'devices', deviceId, 'screenshots', screenshot.id))
}

export async function getScreenshotDownloadURL(screenshot) {
  if (!screenshot?.storagePath) return null
  return await getDownloadURL(storageRef(getStorage(), screenshot.storagePath))
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export function subscribeToAlerts(uid, callback) {
  return onSnapshot(
    query(alertsCol(uid), orderBy('timestamp', 'desc')),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  )
}

export async function acknowledgeAlert(uid, alertId) {
  await updateDoc(doc(db, 'users', uid, 'alerts', alertId), { acknowledged: true })
}

export async function acknowledgeAllAlerts(uid, alertIds) {
  if (!alertIds || alertIds.length === 0) return
  const chunks = []
  for (let i = 0; i < alertIds.length; i += 400) chunks.push(alertIds.slice(i, i + 400))
  
  for (const chunk of chunks) {
    const b = writeBatch(db)
    for (const id of chunk) {
      b.update(doc(db, 'users', uid, 'alerts', id), { acknowledged: true })
    }
    await b.commit()
  }
}

// ─── Pairing codes ────────────────────────────────────────────────────────────

export async function createPairingCode(uid, code) {
  await setDoc(doc(db, 'pairingCodes', code), {
    parentUid: uid,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    used: false
  })
}

// ─── User profile ─────────────────────────────────────────────────────────────

export async function initUserProfile(uid, email) {
  const ref = doc(db, 'users', uid, 'profile', 'data')
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, { email, createdAt: serverTimestamp(), plan: 'free' })
  }
}
