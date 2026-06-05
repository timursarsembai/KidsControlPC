import { initLogCapture } from './core/logBuffer.js'
initLogCapture()

import { eventBus, EVENTS } from './core/eventBus.js'
import { loadConfigCache, getDeviceConfig } from './core/configManager.js'
import { initFirebaseSync, stopFirebaseSync, sendHeartbeat, sendAlert, markDeviceOffline, markCommandCompleted, markCommandFailed } from './network/firebaseSync.js'
import { startTimerWidgetIfNeeded, ensureWidgetLocked } from './services/widgetManager.js'
import { enforceRules } from './services/enforcer.js'

import { loadPairing, runPairingFlow } from './pairing.js'
import { getInstalledPrograms } from './scanner.js'
import { checkAndUpdateSilently } from './updater.js'
import { delay } from './core/utils.js'
import { clearHostsBlock } from './hostsBlocker.js'

import { updateDoc, doc } from 'firebase/firestore'
import { db } from './network/firebaseSync.js'
import { ENFORCE_INTERVAL_MS, HEARTBEAT_INTERVAL_MS } from './config.js'
import { exec } from 'child_process'

let parentUid = null
let deviceId = null
let isShuttingDown = false

function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

async function scanInstalledProgramsWithRetry(maxAttempts = 3, retryDelayMs = 30000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const apps = await getInstalledPrograms()
    if (apps.length > 0) return apps
    if (attempt < maxAttempts) await delay(retryDelayMs)
  }
  return []
}

async function performProgramScan() {
  log('🔎 Scanning installed programs...')
  const apps = await scanInstalledProgramsWithRetry()
  
  if (apps.length === 0) {
    log('⚠️ Scan returned 0 programs. Skipping upload to preserve existing data.')
    return
  }
  
  try {
    await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), {
      installedApps: apps,
      lastScanAt: new Date().toISOString()
    })
    log(`✅ Uploaded ${apps.length} installed programs`)
  } catch (err) {
    log(`❌ Failed to upload programs: ${err.message}`)
  }
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdownFromSignal(reason) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`\n🛑 Stopping agent: ${reason}`)

  const p1 = sendAlert('agent_stopped', reason)
  const p2 = markDeviceOffline().catch(() => {})

  try {
    await Promise.race([
      Promise.all([p1, p2]),
      delay(2000)
    ])
  } catch (err) { }

  clearHostsBlock()
  stopFirebaseSync()
  process.exit(0)
}

process.on('SIGINT',  () => shutdownFromSignal('SIGINT'))
process.on('SIGTERM', () => shutdownFromSignal('SIGTERM'))

// Windows service stop integration
if (process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  })
  rl.on('SIGINT', () => { process.emit('SIGINT') })
}

// ─── Command Handling ──────────────────────────────────────────────────────────
eventBus.on(EVENTS.COMMAND_RECEIVED, async ({ doc: cmdDoc, cmd }) => {
  log(`📥 Received command: ${cmd.action}`)
  try {
    if (cmd.action === 'lock') {
      await ensureWidgetLocked()
    } else if (cmd.action === 'unlock') {
      eventBus.emit(EVENTS.UNLOCK_REQUESTED)
    } else if (cmd.action === 'restart') {
      exec('shutdown /r /t 0')
    } else if (cmd.action === 'shutdown') {
      exec('shutdown /s /t 0')
    }
    await markCommandCompleted(cmdDoc)
  } catch (err) {
    await markCommandFailed(cmdDoc, err.message)
  }
})

import { startIpcServer } from './network/ipcServer.js'

// ─── Main Initialization ───────────────────────────────────────────────────────
async function main() {
  const isService = process.argv.includes('--service')
  log('==============================================')
  log('   KidsControlPC Agent Started')
  log(`   Mode: ${isService ? 'Service' : 'Console'}`)
  log('==============================================')

  startIpcServer()

  let pairing = loadPairing()
  let isNewPairing = false

  if (!pairing) {
    if (isService) {
      log('⚠️ Error: No pairing file found. Service will restart later.')
      process.exit(1)
    }
    pairing = await runPairingFlow()
    isNewPairing = true
  } else {
    log(`🔗 Paired with account. DeviceID: ${pairing.deviceId}`)
    if (!isService) {
      log('✅ Agent is configured and running in background. Terminal will close in 3 seconds...')
      await delay(3000)
      process.exit(0)
    }
  }

  if (process.argv.includes('--pair-only') || isNewPairing) {
    if (isNewPairing) log('✅ Pairing complete! Window will close in 3 seconds...')
    else log('✅ Pairing complete. --pair-only flag detected, exiting.')
    await delay(3000)
    process.exit(0)
  }

  parentUid = pairing.parentUid
  deviceId  = pairing.deviceId

  initFirebaseSync(parentUid, deviceId)

  // Load cache immediately
  loadConfigCache()
  const dc = getDeviceConfig()
  if (dc && dc.isLocked) {
    log('🔒 Cached deviceConfig shows lock is active! Locking instantly...')
    ensureWidgetLocked()
  }

  await sendHeartbeat()
  log('💓 Heartbeat sent')
  await sendAlert('agent_started', 'Background program was started')

  await performProgramScan()
  
  setTimeout(() => {
    if (!isShuttingDown) {
      log('🔁 Running delayed startup program re-scan...')
      performProgramScan().catch(e => log(`⚠️ Delayed scan failed: ${e.message}`))
    }
  }, 3 * 60 * 1000)

  // Start widget listener
  startTimerWidgetIfNeeded()

  // Start timers
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
  setInterval(() => enforceRules(parentUid, deviceId, isShuttingDown), ENFORCE_INTERVAL_MS)
  setInterval(() => checkAndUpdateSilently(log), 2 * 60 * 60 * 1000)
  setTimeout(() => checkAndUpdateSilently(log), 10000)

  log(`✅ Agent started and monitoring processes (DeviceID: ${deviceId})`)
}

async function shutdown(reason) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`\n🛑 Stopping agent: ${reason}`)

  const p1 = sendAlert('agent_stopped', reason).catch(() => {})
  const p2 = markDeviceOffline().catch(() => {})

  try {
    await Promise.race([
      Promise.all([p1, p2]),
      delay(2000)
    ])
  } catch (err) { }

  clearHostsBlock()
  stopFirebaseSync()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', async (err) => {
  console.log(`💥 Uncaught exception: ${err.message}`)
  await sendAlert('agent_error', err.message).catch(() => {})
  process.exit(1)
})

main().catch(async err => {
  console.error('❌ Fatal:', err.message)
  await sendAlert('agent_error', err.message).catch(() => {})
  process.exit(1)
})
