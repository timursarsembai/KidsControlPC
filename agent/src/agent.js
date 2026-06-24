import { createInterface } from 'readline'
import { hostname } from 'os'
import { initLogCapture } from './core/logBuffer.js'
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
import { startTimerWidgetIfNeeded, ensureWidgetLocked } from './services/widgetManager.js'
import { enforceRules } from './services/enforcer.js'
import { startScreenshotService, stopScreenshotService } from './services/screenshotService.js'
import { registerCommandHandlers } from './services/commandHandler.js'
import {
  performProgramRescan,
  PROGRAM_SCAN_INTERVAL_MS
} from './services/programInventory.js'
import { loadPairing, runPairingFlow } from './pairing.js'
import { initChatSync, stopChatSync } from './services/chatSync.js'
import { checkAndUpdateSilently } from './updater.js'
import { delay } from './core/utils.js'
import { clearHostsBlock } from './hostsBlocker.js'
import { ENFORCE_INTERVAL_MS, HEARTBEAT_INTERVAL_MS } from './config.js'

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

  initFirebaseSync(parentUid, deviceId)
  startScreenshotService(parentUid, deviceId)

  loadConfigCache()
  const dc = getDeviceConfig()
  if (dc && dc.isLocked) {
    log('🔒 Cached deviceConfig shows lock is active! Locking instantly...')
    ensureWidgetLocked()
  }

  // Chat sync: subscribe to chats for this device, handle child replies
  const chatDeviceName = dc?.alias || dc?.hostname || hostname()
  initChatSync(parentUid, deviceId, chatDeviceName)

  await sendHeartbeat()
  log('💓 Heartbeat sent')
  await sendAlert('agent_started', 'Background program was started')

  await performProgramRescan(parentUid, deviceId, log, 'startup')

  setTimeout(() => {
    if (!isShuttingDown) {
      log('🔁 Running delayed startup program re-scan...')
      performProgramRescan(parentUid, deviceId, log, 'delayed-startup')
        .catch(e => log(`⚠️ Delayed scan failed: ${e.message}`))
    }
  }, 3 * 60 * 1000)

  startTimerWidgetIfNeeded()

  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
  setInterval(() => enforceRules(parentUid, deviceId, isShuttingDown), ENFORCE_INTERVAL_MS)
  setInterval(() => {
    if (!isShuttingDown) {
      performProgramRescan(parentUid, deviceId, log, 'periodic')
        .catch(e => log(`⚠️ Periodic scan failed: ${e.message}`))
    }
  }, PROGRAM_SCAN_INTERVAL_MS)
  setInterval(() => checkAndUpdateSilently(log), 2 * 60 * 60 * 1000)
  setTimeout(() => checkAndUpdateSilently(log), 10000)

  log(`✅ Agent started and monitoring processes (DeviceID: ${deviceId})`)
}

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
