import { createInterface } from 'readline'
import { hostname } from 'os'
import { initLogCapture } from './core/logBuffer.js'
import { initErrorTracking, captureError, setAgentContext } from './core/errorTracking.js'
initErrorTracking()
initLogCapture()

import { loadConfigCache, getDeviceConfig } from './core/configManager.js'
import {
  initFirebaseSync,
  stopFirebaseSync,
  sendHeartbeat,
  sendAlert,
  markDeviceOffline
} from './network/firebaseSync.js'
import { startIpcServer } from './network/ipcServer.js'
import { startTimerWidgetIfNeeded, ensureWidgetLocked, getIsWidgetLocked } from './services/widgetManager.js'
import { enforceRules } from './services/enforcer.js'
import { startScreenshotService, stopScreenshotService } from './services/screenshotService.js'
import { registerCommandHandlers } from './services/commandHandler.js'
import {
  performProgramRescan,
  PROGRAM_SCAN_INTERVAL_MS
} from './services/programInventory.js'
import { loadPairing, runPairingFlow } from './pairing.js'
import { initChatSync, stopChatSync } from './services/chatSync.js'
import { startChatWidgetIfNeeded } from './services/chatWidgetManager.js'
import { checkAndUpdateSilently } from './updater.js'
import { tickScreenTime } from './services/activityTracker.js'
import { tickDnsTracking } from './services/dnsTracker.js'
import { delay } from './core/utils.js'
import { withOperationTimeout } from './services/operationTimeout.js'
import { clearHostsBlock } from './hostsBlocker.js'
import { ENFORCE_INTERVAL_MS, HEARTBEAT_INTERVAL_MS } from './config.js'

// Cap on each network-dependent startup step so main() always reaches the end.
const STARTUP_STEP_TIMEOUT_MS = 30_000

let parentUid = null
let deviceId = null
let isShuttingDown = false

function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

registerCommandHandlers(log)

async function shutdown(reason) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`\n🛑 Stopping agent: ${reason}`)

  const p1 = sendAlert('agent_stopped', reason).catch(() => {})
  const p2 = markDeviceOffline().catch(() => {})

  try {
    await Promise.race([
      Promise.all([p1, p2]),
      delay(2000)
    ])
  } catch (err) { }

  clearHostsBlock()
  stopScreenshotService()
  stopChatSync()
  stopFirebaseSync()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

if (process.platform === 'win32') {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })
  rl.on('SIGINT', () => { process.emit('SIGINT') })
}

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
  deviceId = pairing.deviceId
  setAgentContext(parentUid, deviceId)

  // Enforcement must not depend on the network. loadConfigCache() restores the last
  // known rules from disk, so blocking keeps working while offline — critical after a
  // Windows 11 Modern Standby resume, when the NIC is down for tens of seconds.
  loadConfigCache()
  const dc = getDeviceConfig()
  if (dc && dc.isLocked) {
    log('🔒 Cached deviceConfig shows lock is active! Locking instantly...')
    ensureWidgetLocked()
  }

  startTimerWidgetIfNeeded()

  // Scheduled BEFORE any network await. These used to be registered at the very end
  // of main(), so a single hung startup call (initChatSync's getDocs has no timeout)
  // left the service "running" with no enforcement and no heartbeat at all.
  let _dnsTick = 0
  setInterval(() => {
    sendHeartbeat()
    if (!getIsWidgetLocked()) tickScreenTime(parentUid, deviceId, HEARTBEAT_INTERVAL_MS / 1000).catch(() => {})
    if (++_dnsTick % 2 === 0) tickDnsTracking(parentUid, deviceId).catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)
  setInterval(() => enforceRules(parentUid, deviceId, isShuttingDown), ENFORCE_INTERVAL_MS)
  log('🛡️ Enforcement scheduled (works offline from cached rules)')

  // Everything below needs the network. Each step is capped so a slow or missing
  // connection can delay startup but can never stall it.
  await withOperationTimeout(
    initFirebaseSync(parentUid, deviceId),
    STARTUP_STEP_TIMEOUT_MS,
    'initFirebaseSync timed out'
  ).catch(e => log(`⚠️ ${e.message} — continuing offline, listeners retry on their own`))

  startScreenshotService(parentUid, deviceId)

  const chatDeviceName = dc?.alias || dc?.hostname || hostname()
  withOperationTimeout(
    initChatSync(parentUid, deviceId, chatDeviceName),
    STARTUP_STEP_TIMEOUT_MS,
    'initChatSync timed out'
  ).catch(e => log(`⚠️ ${e.message}`))
  startChatWidgetIfNeeded().catch(e => log(`⚠️ Chat widget launch failed: ${e.message}`))

  sendHeartbeat().catch(() => {})
  sendAlert('agent_started', 'Background program was started').catch(() => {})

  performProgramRescan(parentUid, deviceId, log, 'startup')
    .catch(e => log(`⚠️ Startup scan failed: ${e.message}`))

  setTimeout(() => {
    if (!isShuttingDown) {
      log('🔁 Running delayed startup program re-scan...')
      performProgramRescan(parentUid, deviceId, log, 'delayed-startup')
        .catch(e => log(`⚠️ Delayed scan failed: ${e.message}`))
    }
  }, 3 * 60 * 1000)
  setInterval(() => {
    if (!isShuttingDown) {
      performProgramRescan(parentUid, deviceId, log, 'periodic')
        .catch(e => log(`⚠️ Periodic scan failed: ${e.message}`))
    }
  }, PROGRAM_SCAN_INTERVAL_MS)
  setInterval(() => checkAndUpdateSilently(log), 2 * 60 * 60 * 1000)
  setTimeout(() => checkAndUpdateSilently(log), 10000)
  setInterval(() => {
    if (!isShuttingDown) {
      startChatWidgetIfNeeded().catch(e => log(`⚠️ Chat widget watchdog failed: ${e.message}`))
    }
  }, 2 * 60 * 1000)

  log(`✅ Agent started and monitoring processes (DeviceID: ${deviceId})`)
}

process.on('uncaughtException', async (err) => {
  console.log(`💥 Uncaught exception: ${err.message}`)
  captureError(err, { phase: 'uncaughtException' })
  await sendAlert('agent_error', err.message).catch(() => {})
  process.exit(1)
})

main().catch(async err => {
  console.error('❌ Fatal:', err.message)
  captureError(err, { phase: 'main' })
  await sendAlert('agent_error', err.message).catch(() => {})
  process.exit(1)
})
