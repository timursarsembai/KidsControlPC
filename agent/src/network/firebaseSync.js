import { initializeApp } from 'firebase/app'
import { initializeAuth, signInAnonymously } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  getFirestore, collection, doc,
  query, where, onSnapshot,
  updateDoc, addDoc, serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { hostname } from 'os'
import { firebaseConfig, AGENT_AUTH_FILE, FUNCTIONS_REGION, AGENT_VERSION } from '../config.js'
import { eventBus, EVENTS } from '../core/eventBus.js'
import { setDeviceConfig, setActiveRules, setParentConfig } from '../core/configManager.js'
import { getRecentLogs } from '../core/logBuffer.js'

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)

// File-based Firebase Auth persistence for Node.js (no browser storage available).
// Saves the anonymous session so the same UID is used across agent restarts.
function makeFilePersistence(filePath) {
  function readStore() {
    try { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : {} } catch { return {} }
  }
  function writeStore(store) {
    try { writeFileSync(filePath, JSON.stringify(store), 'utf8') } catch {}
  }
  return {
    type: 'LOCAL',
    _isAvailable: () => Promise.resolve(true),
    _set: async (key, value) => { const s = readStore(); s[key] = value; writeStore(s) },
    _get: async (key) => readStore()[key] ?? null,
    _remove: async (key) => { const s = readStore(); delete s[key]; writeStore(s) },
    _addListener: () => {},
    _removeListener: () => {}
  }
}

export const auth = initializeAuth(app, { persistence: [makeFilePersistence(AGENT_AUTH_FILE)] })
export const functions = getFunctions(app, FUNCTIONS_REGION)

let parentUid = null
let deviceId = null
let unsubParent = null
let unsubDevice = null
let unsubRules = null
let unsubCommands = null
let commandToken = null

function log(msg) {
  console.log(`[FirebaseSync] ${msg}`)
}

function subscribeToCommands(token) {
  if (!token || token === commandToken) return
  commandToken = token

  if (unsubCommands) unsubCommands()

  const qCmds = query(
    collection(db, 'users', parentUid, 'devices', deviceId, 'commands'),
    where('status', '==', 'pending'),
    where('uploadToken', '==', token)
  )

  unsubCommands = onSnapshot(qCmds, async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'added') {
        const cmdDoc = change.doc
        const cmd = cmdDoc.data()
        eventBus.emit(EVENTS.COMMAND_RECEIVED, { doc: cmdDoc, cmd })
      }
    }
  }, (err) => {
    log(`Commands sync error: ${err.message}`)
  })
}

export async function initFirebaseSync(pUid, dId) {
  parentUid = pUid
  deviceId = dId

  // Ensure anonymous session is active (restored from file or created fresh).
  if (!auth.currentUser) {
    await signInAnonymously(auth)
    log(`Signed in anonymously: ${auth.currentUser.uid}`)
  } else {
    log(`Using persisted auth session: ${auth.currentUser.uid}`)
  }

  // Register this agent's UID in the device doc so Firestore rules can verify it.
  // Safe to call on every startup — idempotent.
  try {
    const registerFn = httpsCallable(functions, 'registerAgentUid')
    await registerFn({ parentUid, deviceId })
    log(`Agent UID registered in device doc`)
  } catch (err) {
    log(`Warning: registerAgentUid failed: ${err.message} — continuing with legacy open rules`)
  }

  const parentRef = doc(db, 'users', parentUid)
  unsubParent = onSnapshot(parentRef, (snap) => {
    if (!snap.exists()) return
    setParentConfig(snap.data())
  }, (err) => {
    log(`Firestore parent config error: ${err.message}`)
  })

  const deviceRef = doc(db, 'users', parentUid, 'devices', deviceId)
  unsubDevice = onSnapshot(deviceRef, (snap) => {
    if (!snap.exists()) return
    const deviceConfig = snap.data()
    setDeviceConfig(deviceConfig)
    subscribeToCommands(deviceConfig.screenshotUploadToken)
  }, (err) => {
    log(`Firestore device config error: ${err.message}`)
  })

  const qRules = query(
    collection(db, 'users', parentUid, 'devices', deviceId, 'rules'),
    where('status', 'in', ['active', 'inactive'])
  )
  unsubRules = onSnapshot(qRules, (snap) => {
    const rules = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    log(`Received ${rules.length} rules`)
    setActiveRules(rules)
  }, (err) => {
    log(`Firestore rules error: ${err.message}`)
  })
}

export function stopFirebaseSync() {
  if (unsubParent) unsubParent()
  if (unsubDevice) unsubDevice()
  if (unsubRules) unsubRules()
  if (unsubCommands) unsubCommands()
  commandToken = null
}

let consecutiveFailures = 0

export async function sendHeartbeat() {
  if (!parentUid || !deviceId) return
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Heartbeat timeout')), 15000)
    )
    await Promise.race([
      updateDoc(
        doc(db, 'users', parentUid, 'devices', deviceId),
        { lastSeen: serverTimestamp(), status: 'online', agentVersion: AGENT_VERSION }
      ),
      timeoutPromise
    ])
    consecutiveFailures = 0
  } catch (err) {
    if (err.message.includes('RESOURCE_EXHAUSTED')) {
      consecutiveFailures = 0
    } else if (err.message.includes('NOT_FOUND')) {
      consecutiveFailures = 0
    } else {
      consecutiveFailures++
      log(`Heartbeat error (${consecutiveFailures}/3): ${err.message}`)
      if (consecutiveFailures >= 3) {
        log('Network likely stuck after sleep/disconnect. Restarting agent...')
        process.exit(1)
      }
    }
  }
}

const lastAlerts = {}

export async function sendAlert(type, details = '') {
  if (!parentUid) return

  const alertKey = `${type}|${details}`
  const now = Date.now()
  if (lastAlerts[alertKey] && (now - lastAlerts[alertKey]) < 60000) {
    return
  }
  lastAlerts[alertKey] = now

  try {
    await addDoc(collection(db, 'users', parentUid, 'alerts'), {
      type,
      details,
      deviceId,
      deviceHostname: hostname(),
      timestamp: serverTimestamp(),
      acknowledged: false
    })
    log(`Alert sent: ${type}`)
  } catch (err) {
    log(`Failed to send alert: ${err.message}`)
  }
}

export async function markCommandCompleted(cmdDoc, extra = {}) {
  try {
    await updateDoc(cmdDoc.ref, { status: 'completed', completedAt: serverTimestamp(), ...extra })
  } catch {}
}

export async function markCommandFailed(cmdDoc, errorMsg, extra = {}) {
  try {
    await updateDoc(cmdDoc.ref, { status: 'failed', error: errorMsg, completedAt: serverTimestamp(), ...extra })
  } catch {}
}

export async function markDeviceOffline() {
  if (!parentUid || !deviceId) return
  try {
    await updateDoc(
      doc(db, 'users', parentUid, 'devices', deviceId),
      { status: 'offline', lastSeen: serverTimestamp() }
    )
  } catch {}
}

export async function publishPomodoroState(state) {
  if (!parentUid || !deviceId) return
  const pomodoroState = state ? {
    active: true,
    phase: state.phase,
    isWorkPhase: state.isWorkPhase,
    phaseEndsAtMs: state.phaseEndsAtMs,
    startedAtMs: state.startedAtMs,
    workDuration: state.workDuration,
    breakDuration: state.breakDuration,
    longBreakDuration: state.longBreakDuration,
    cyclesToLongBreak: state.cyclesToLongBreak,
    updatedAt: serverTimestamp()
  } : {
    active: false,
    updatedAt: serverTimestamp()
  }

  try {
    await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), { pomodoroState })
  } catch {}
}

export async function pushRecentLogs() {
  if (!parentUid || !deviceId) return
  try {
    await updateDoc(
      doc(db, 'users', parentUid, 'devices', deviceId),
      { recentLogs: getRecentLogs().slice(-100) }
    )
  } catch (err) {
    log(`Failed to push logs: ${err.message}`)
  }
}
