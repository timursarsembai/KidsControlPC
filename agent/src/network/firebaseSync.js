// MUST be first: installs a pkg-safe fetch before firebase/auth is evaluated,
// otherwise Auth cannot refresh the ID token and Firestore starts failing after
// the token's one-hour lifetime.
import './fetchPolyfill.js'
import { initializeApp } from 'firebase/app'
import { initializeAuth, signInWithCustomToken } from 'firebase/auth'
import {
  getFirestore, collection, doc,
  query, where, onSnapshot,
  updateDoc, addDoc, serverTimestamp,
  disableNetwork, enableNetwork
} from 'firebase/firestore'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import https from 'https'
import { hostname, freemem, totalmem } from 'os'
import { firebaseConfig, AGENT_AUTH_FILE, PAIRING_FILE, FUNCTIONS_REGION, AGENT_VERSION } from '../config.js'
import { eventBus, EVENTS } from '../core/eventBus.js'
import { setDeviceConfig, setActiveRules, setParentConfig } from '../core/configManager.js'
import { getRecentLogs } from '../core/logBuffer.js'

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)

// File-based Firebase Auth persistence for Node.js (no browser storage available).
// Saves the anonymous session so the same UID is used across agent restarts.
// Must return a CLASS (constructor), not a plain object — Firebase Auth v10 calls
// _getInstance() which checks typeof cls === 'function' and does new cls() internally.
function makeFilePersistence(filePath) {
  function readStore() {
    try { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : {} } catch { return {} }
  }
  function writeStore(store) {
    try { writeFileSync(filePath, JSON.stringify(store), 'utf8') } catch {}
  }
  return class FilePersistence {
    static type = 'LOCAL'
    type = 'LOCAL'
    async _isAvailable() { return true }
    async _set(key, value) { const s = readStore(); s[key] = value; writeStore(s) }
    async _get(key) { return readStore()[key] ?? null }
    async _remove(key) { const s = readStore(); delete s[key]; writeStore(s) }
    _addListener() {}
    _removeListener() {}
  }
}

export const auth = initializeAuth(app, { persistence: [makeFilePersistence(AGENT_AUTH_FILE)] })
// (No getFunctions/httpsCallable — CF calls use callCF() with Node.js https module)

// Direct HTTPS call to a Firebase Callable Function — bypasses Firebase Functions SDK
// (which requires a working fetch implementation). Uses Node.js built-in https module
// that reliably works inside pkg/Node.js executables.
export async function callCF(fnName, data) {
  // Callable Functions read the caller identity from this header. Without it every
  // CF sees request.auth === undefined, which is why registerAgentUid could never
  // succeed and agentUid stayed null on every device — leaving the device doc
  // writable by anyone via the isDeviceAgent(storedUid == null) fallback.
  let authHeader = null
  try {
    if (auth.currentUser) authHeader = `Bearer ${await auth.currentUser.getIdToken()}`
  } catch (err) {
    log(`Could not attach ID token to ${fnName}: ${err.message}`)
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ data })
    const options = {
      hostname: `${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net`,
      path: `/${fnName}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(authHeader ? { Authorization: authHeader } : {})
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(raw)
          if (json.result !== undefined) resolve(json.result)
          else reject(new Error(json.error?.message || `CF ${fnName} error`))
        } catch { reject(new Error(`CF ${fnName}: invalid JSON response`)) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

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

// True once the agent holds the `agent_<deviceId>` identity that the security rules
// require. Kept separate from initFirebaseSync so it can be retried: if the network is
// down at startup — routine after a Windows 11 Modern Standby resume — the agent used
// to stay unauthenticated for its whole lifetime, which the legacy open rules happened
// to tolerate. They no longer will.
export async function ensureAgentAuth() {
  const expectedUid = `agent_${deviceId}`
  if (auth.currentUser?.uid === expectedUid) return true

  if (auth.currentUser) {
    log(`Replacing stale session ${auth.currentUser.uid} with the device agent identity`)
  }
  try {
    const pairing = existsSync(PAIRING_FILE)
      ? JSON.parse(readFileSync(PAIRING_FILE, 'utf8'))
      : null
    if (!pairing?.screenshotUploadToken) {
      throw new Error('pairing.json has no screenshotUploadToken — re-pair this device')
    }
    const result = await callCF('getAgentToken', {
      parentUid, deviceId,
      uploadToken: pairing.screenshotUploadToken
    })
    await signInWithCustomToken(auth, result.token)
    log(`Signed in with custom token: ${auth.currentUser.uid}`)

    try {
      await callCF('registerAgentUid', { parentUid, deviceId })
      log('Agent UID registered in device doc')
    } catch (err) {
      log(`Warning: registerAgentUid failed: ${err.message}`)
    }
    return true
  } catch (err) {
    log(`Custom token auth failed: ${err.message}`)
    return false
  }
}

// onSnapshot kills a listener permanently on a terminal error (permission-denied while
// unauthenticated, for instance) and never retries by itself. Re-subscribing keeps rule
// delivery alive instead of leaving the agent running with stale cached rules forever.
function subscribeAll() {
  if (unsubParent) unsubParent()
  if (unsubDevice) unsubDevice()
  if (unsubRules) unsubRules()

  const parentRef = doc(db, 'users', parentUid)
  unsubParent = onSnapshot(parentRef, (snap) => {
    if (!snap.exists()) return
    setParentConfig(snap.data())
  }, (err) => {
    log(`Firestore parent config error: ${err.message}`)
    scheduleResubscribe()
  })

  const deviceRef = doc(db, 'users', parentUid, 'devices', deviceId)
  unsubDevice = onSnapshot(deviceRef, (snap) => {
    if (!snap.exists()) return
    const deviceConfig = snap.data()
    setDeviceConfig(deviceConfig)
    subscribeToCommands(deviceConfig.screenshotUploadToken)
  }, (err) => {
    log(`Firestore device config error: ${err.message}`)
    scheduleResubscribe()
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
    scheduleResubscribe()
  })
}

let resubscribeTimer = null
function scheduleResubscribe() {
  if (resubscribeTimer) return
  resubscribeTimer = setTimeout(async () => {
    resubscribeTimer = null
    log('Re-authenticating and re-subscribing after listener failure')
    await ensureAgentAuth()
    subscribeAll()
  }, 30_000)
}

export async function initFirebaseSync(pUid, dId) {
  parentUid = pUid
  deviceId = dId

  await ensureAgentAuth()
  subscribeAll()
}

export function stopFirebaseSync() {
  if (unsubParent) unsubParent()
  if (unsubDevice) unsubDevice()
  if (unsubRules) unsubRules()
  if (unsubCommands) unsubCommands()
  commandToken = null
}

let consecutiveFailures = 0
let isReconnecting = false

// Forces the Firestore gRPC channel to be torn down and rebuilt. After a Windows 11
// Modern Standby resume the NIC returns seconds later but the existing Listen/Write
// streams stay wedged, so every updateDoc sits unresolved until it times out.
async function resetFirestoreConnection() {
  if (isReconnecting) return
  isReconnecting = true
  try {
    // Report memory alongside the reset: a machine out of RAM produces the same
    // ENETUNREACH/timeout symptoms as a genuinely disconnected one, and telling those
    // two apart from the log alone was otherwise impossible.
    const freeMb = Math.round(freemem() / 1048576)
    const totalMb = Math.round(totalmem() / 1048576)
    log(`Resetting Firestore connection after repeated heartbeat failures (${freeMb}MB free of ${totalMb}MB)`)
    await disableNetwork(db)
    await enableNetwork(db)
    consecutiveFailures = 0
    log('Firestore connection reset complete')
  } catch (err) {
    log(`Firestore reconnect failed: ${err.message}`)
  } finally {
    isReconnecting = false
  }
}

export async function sendHeartbeat() {
  if (!parentUid || !deviceId) return

  // Recovers the case where the network was unavailable during startup.
  if (auth.currentUser?.uid !== `agent_${deviceId}`) {
    const ok = await ensureAgentAuth()
    if (ok) subscribeAll()
  }

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
        // Used to be process.exit(1), trusting the Windows service to restart us.
        // That turned every sleep/resume into a kill, and if the network was still
        // down on the next start main() could hang before enforcement was ever
        // scheduled - agent "running" with no rules applied. Recover in-process.
        await resetFirestoreConnection()
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

  // Prune old entries to prevent unbounded growth (alerts carry variable
  // `details` text, e.g. per-process kill messages, so keys keep accumulating)
  for (const key of Object.keys(lastAlerts)) {
    if (now - lastAlerts[key] > 60000) delete lastAlerts[key]
  }

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
