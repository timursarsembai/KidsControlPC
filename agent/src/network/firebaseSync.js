import { initializeApp } from 'firebase/app'
import {
  getFirestore, collection, doc,
  query, where, onSnapshot,
  updateDoc, addDoc, serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { hostname } from 'os'
import { firebaseConfig, AGENT_VERSION } from '../config.js'
import { eventBus, EVENTS } from '../core/eventBus.js'
import { setDeviceConfig, setActiveRules } from '../core/configManager.js'
import { getRecentLogs } from '../core/logBuffer.js'

// ─── Init Firebase ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)

let parentUid = null
let deviceId = null
let unsubDevice = null
let unsubRules = null
let unsubCommands = null

function log(msg) {
  console.log(`[FirebaseSync] ${msg}`)
}

export function initFirebaseSync(pUid, dId) {
  parentUid = pUid
  deviceId = dId

  // Subscribe to device config
  const deviceRef = doc(db, 'users', parentUid, 'devices', deviceId)
  unsubDevice = onSnapshot(deviceRef, (snap) => {
    if (!snap.exists()) return
    const deviceConfig = snap.data()
    setDeviceConfig(deviceConfig)
  }, (err) => {
    log(`❌ Firestore device config error: ${err.message}`)
  })

  // Subscribe to rules
  const qRules = query(
    collection(db, 'users', parentUid, 'devices', deviceId, 'rules'),
    where('status', 'in', ['active', 'inactive'])
  )
  unsubRules = onSnapshot(qRules, (snap) => {
    const rules = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    log(`📋 Received ${rules.length} rules`)
    setActiveRules(rules)
  }, (err) => {
    log(`❌ Firestore rules error: ${err.message}`)
  })

  // Subscribe to commands
  const qCmds = query(
    collection(db, 'users', parentUid, 'devices', deviceId, 'commands'),
    where('status', '==', 'pending')
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
    log(`⚠️  Commands sync error: ${err.message}`)
  })
}

export function stopFirebaseSync() {
  if (unsubDevice) unsubDevice()
  if (unsubRules) unsubRules()
  if (unsubCommands) unsubCommands()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      log(`⚠️  Heartbeat error (${consecutiveFailures}/3): ${err.message}`)
      if (consecutiveFailures >= 3) {
        log('🔄 Network likely stuck after sleep/disconnect. Restarting agent...')
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
    log(`🚨 Alert sent: ${type}`)
  } catch (err) {
    log(`⚠️  Failed to send alert: ${err.message}`)
  }
}

export async function markCommandCompleted(cmdDoc) {
  try {
    await updateDoc(cmdDoc.ref, { status: 'completed', completedAt: serverTimestamp() })
  } catch(e) {}
}

export async function markCommandFailed(cmdDoc, errorMsg) {
  try {
    await updateDoc(cmdDoc.ref, { status: 'failed', error: errorMsg, completedAt: serverTimestamp() })
  } catch(e) {}
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
  // Logic to publish state...
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
  } catch (err) {}
}

export async function pushRecentLogs() {
  if (!parentUid || !deviceId) return
  try {
    await updateDoc(
      doc(db, 'users', parentUid, 'devices', deviceId),
      { recentLogs: getRecentLogs().slice(-100) }
    )
  } catch (err) {
    log(`⚠️ Failed to push logs: ${err.message}`)
  }
}
