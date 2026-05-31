/**
 * KidsControlPC — Child Agent
 * Main entry point. Runs as a background process on the child's PC.
 *
 * Responsibilities:
 *  1. Pair with parent account (first run only)
 *  2. Scan and upload installed programs
 *  3. Subscribe to Firestore rules in realtime (per-device)
 *  4. Block websites via hosts file
 *  5. Kill blocked processes every 5 seconds
 *  6. Update running status of apps in Firestore
 *  7. Send heartbeat to Firebase every 30 seconds
 *  8. Alert parent on unexpected shutdown (SIGTERM/SIGINT)
 */

import { initializeApp }           from 'firebase/app'
import {
  getFirestore, collection, doc,
  query, where, onSnapshot,
  updateDoc, addDoc, serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { hostname } from 'os'

import { firebaseConfig, HEARTBEAT_INTERVAL_MS, ENFORCE_INTERVAL_MS } from './config.js'
import { loadPairing, runPairingFlow }    from './pairing.js'
import { applyHostsBlock, clearHostsBlock, extractDomains } from './hostsBlocker.js'
import { enforceProcessRules }            from './processEnforcer.js'
import { getInstalledPrograms, getRunningProcesses } from './scanner.js'
import { checkAndUpdateSilently }         from './updater.js'

// ─── Init Firebase ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

let parentUid = null
let deviceId  = null
let heartbeatTimer = null
let enforceTimer = null
let updateTimer = null
let unsubRules = null
let unsubCommands = null
let unsubDevice = null

let activeRules = []
let isShuttingDown = false
let installedAppsCached = []
let runningStateCache = {}

let deviceConfig = null
let isWidgetLocked = false

const crypto = require('crypto')
const net = require('net')

// ─── Logging helper ───────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

let consecutiveFailures = 0

// ─── Heartbeat — update lastSeen in Firestore ─────────────────────────────────
async function sendHeartbeat() {
  if (!parentUid || !deviceId) return
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Heartbeat timeout')), 15000)
    )

    await Promise.race([
      updateDoc(
        doc(db, 'users', parentUid, 'devices', deviceId),
        { lastSeen: serverTimestamp(), status: 'online' }
      ),
      timeoutPromise
    ])
    
    consecutiveFailures = 0 // reset on success
  } catch (err) {
    consecutiveFailures++
    log(`⚠️  Heartbeat error (${consecutiveFailures}/3): ${err.message}`)
    if (consecutiveFailures >= 3) {
      log('🔄 Network likely stuck after sleep/disconnect. Restarting agent...')
      process.exit(1)
    }
  }
}

// ─── Send alert to parent ──────────────────────────────────────────────────────
async function sendAlert(type, details = '') {
  if (!parentUid) return
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

// ─── Scan and upload installed programs ──────────────────────────────────────
async function performProgramScan() {
  log('🔍 Scanning installed programs...')
  try {
    const apps = await getInstalledPrograms()
    installedAppsCached = apps
    log(`🔎 Found ${apps.length} programs. Uploading to Firestore...`)

    const col = collection(db, 'users', parentUid, 'devices', deviceId, 'installedApps')
    
    // Chunk upload to respect Firestore batch limit of 500 writes
    const chunks = []
    for (let i = 0; i < apps.length; i += 400) {
      chunks.push(apps.slice(i, i + 400))
    }

    for (const chunk of chunks) {
      const batch = writeBatch(db)
      for (const app of chunk) {
        const ref = doc(col, app.id)
        batch.set(ref, {
          name: app.name,
          path: app.path,
          publisher: app.publisher,
          version: app.version,
          uninstallCmd: app.uninstallCmd,
          running: false
        }, { merge: true })
      }
      await batch.commit()
    }
    log(`📤 Program list successfully uploaded (${apps.length} items)`)
  } catch (err) {
    log(`⚠️  Error during scanning/uploading: ${err.message}`)
  }
}

// ─── Update running statuses of programs ─────────────────────────────────────
async function updateRunningStatuses(processes) {
  if (installedAppsCached.length === 0) return

  const runningPaths = new Set(processes.map(p => p.path?.toLowerCase()).filter(Boolean))
  const runningBases = new Set(processes.map(p => p.base?.toLowerCase()).filter(Boolean))
  const runningNames = new Set(processes.map(p => p.name?.toLowerCase().replace(/\s+/g, '')).filter(Boolean))

  const changedApps = []

  for (const app of installedAppsCached) {
    const pathLow = app.path?.toLowerCase() || ''
    const baseLow = app.exeBasename || ''
    const nameLow = app.name.toLowerCase().replace(/\s+/g, '')

    const isRunningNow =
      (pathLow && runningPaths.has(pathLow)) ||
      (baseLow && runningBases.has(baseLow)) ||
      runningNames.has(nameLow)

    const prevRunning = runningStateCache[app.id] ?? false
    if (isRunningNow !== prevRunning) {
      runningStateCache[app.id] = isRunningNow
      changedApps.push({ id: app.id, running: isRunningNow })
    }
  }

  if (changedApps.length > 0) {
    try {
      const batch = writeBatch(db)
      const col = collection(db, 'users', parentUid, 'devices', deviceId, 'installedApps')
      for (const item of changedApps) {
        batch.update(doc(col, item.id), { running: item.running })
      }
      await batch.commit()
      log(`🔄 Updated running status for ${changedApps.length} programs`)
    } catch (err) {
      log(`⚠️  Error updating program status: ${err.message}`)
    }
  }
}

function sendToWidget(message) {
  return new Promise((resolve) => {
    const client = new net.Socket()
    client.connect(49152, '127.0.0.1', () => {
      client.write(message)
      client.destroy()
      resolve(true)
    })
    client.on('error', () => {
      resolve(false)
    })
  })
}

let widgetServer = null
function startWidgetListener() {
  widgetServer = net.createServer((socket) => {
    socket.on('data', async (data) => {
      const msg = data.toString().trim()
      if (msg === 'unlock_by_pin') {
        log('🔓 Widget unlocked by PIN')
        // Send alert
        await sendAlert('pin_unlock', 'Разблокировка по ПИН-коду')
        // Update device document
        try {
          await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), {
            isLocked: false
          })
        } catch (err) {
          log('❌ Error updating isLocked state: ' + err.message)
        }
      } else if (msg.startsWith('reminder_dismissed|')) {
        const parts = msg.split('|')
        const ruleId = parts[1]
        log(`🔔 Reminder dismissed: ${ruleId}`)
        await sendAlert('reminder_dismissed', `Напоминание прочитано`)
      }
    })
  })
  widgetServer.listen(49153, '127.0.0.1')
  widgetServer.on('error', () => { /* ignore if already listening */ })
}

// ─── Enforce rules ─────────────────────────────────────────────────────────────
async function enforceRules() {
  if (isShuttingDown) return
  
  if (deviceConfig?.isLocked && !isWidgetLocked) {
    await ensureWidgetLocked()
  }

  // 1. Get running processes once to save CPU
  const processes = await getRunningProcesses()

  // 2. Update running status of apps in Firestore
  await updateRunningStatuses(processes)

  if (activeRules.length === 0) {
    sendToWidget('hide')
    return
  }

  // 3. Determine active rules (status === 'active' and within schedule/timer/date)
  const now = new Date()
  let hasPomodoro = false

  // Process reminders
  import('./reminder.js').then(m => m.processReminders(activeRules)).catch(e => log(`⚠️ Reminder error: ${e.message}`))

  const effectiveRules = activeRules.flatMap(rule => {
    if (rule.status !== 'active') return []

    if (rule.type === 'pomodoro') {
      if (!rule.startedAt || !rule.workDuration || !rule.breakDuration) return []
      const startedAt = rule.startedAt?.toDate?.() || new Date(rule.startedAt)
      const elapsed = now - startedAt
      if (elapsed < 0) return []
      const workMs = rule.workDuration * 60 * 1000
      const breakMs = rule.breakDuration * 60 * 1000
      const longBreakMs = (rule.longBreakDuration || 15) * 60 * 1000
      const cyclesToLongBreak = rule.cyclesToLongBreak || 3

      const blockMs = (workMs + breakMs) * (cyclesToLongBreak - 1) + (workMs + longBreakMs)
      const blockElapsed = elapsed % blockMs

      let currentElapsed = 0
      let isWorkPhase = false
      let phaseRemainingMs = 0

      for (let i = 0; i < cyclesToLongBreak; i++) {
        if (blockElapsed < currentElapsed + workMs) {
          isWorkPhase = true
          phaseRemainingMs = (currentElapsed + workMs) - blockElapsed
          break
        }
        currentElapsed += workMs
        
        const currentBreakMs = (i === cyclesToLongBreak - 1) ? longBreakMs : breakMs
        if (blockElapsed < currentElapsed + currentBreakMs) {
          isWorkPhase = false
          phaseRemainingMs = (currentElapsed + currentBreakMs) - blockElapsed
          break
        }
        currentElapsed += currentBreakMs
      }
      
      hasPomodoro = true
      const rSec = Math.floor(phaseRemainingMs / 1000)
      const rMinStr = Math.floor(rSec / 60).toString().padStart(2, '0')
      const rSecStr = (rSec % 60).toString().padStart(2, '0')
      const phaseStr = isWorkPhase ? 'Фокус (Работа)' : 'Пауза (Отдых)'
      sendToWidget(`show|${phaseStr}|${rMinStr}:${rSecStr}`)

      if (isWorkPhase) {
        const virtualRules = []
        if (rule.targets?.programs) {
          rule.targets.programs.forEach(pName => {
            virtualRules.push({ type: 'program', program: { name: pName } })
          })
        }
        if (rule.targets?.websites) {
          rule.targets.websites.forEach(wUrl => {
            virtualRules.push({ type: 'web', web: { resolvedPattern: wUrl } })
          })
        }
        return virtualRules
      }
      return []
    }

    switch (rule.mode) {
      case 'permanent': return [rule]

      case 'timer': {
        if (!rule.timer?.startedAt || !rule.timer?.duration) return []
        const startedAt  = rule.timer.startedAt?.toDate?.() || new Date(rule.timer.startedAt)
        const durationMs = Number(rule.timer.duration) * 60 * 1000
        return (now - startedAt) < durationMs ? [rule] : []
      }

      case 'schedule': {
        if (!rule.schedule?.weekdays || !rule.schedule?.timeFrom || !rule.schedule?.timeTo) return []
        const action = rule.schedule.action || 'block'
        const dayOfWeek = now.getDay()    // 0=Sun .. 6=Sat
        const mappedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1  // Mon=0..Sun=6
        const isRightDay = rule.schedule.weekdays.includes(mappedDay)
        
        const [hFrom, mFrom] = rule.schedule.timeFrom.split(':').map(Number)
        const [hTo,   mTo  ] = rule.schedule.timeTo.split(':').map(Number)
        const cur = now.getHours() * 60 + now.getMinutes()
        const from = hFrom * 60 + mFrom
        const to   = hTo   * 60 + mTo
        
        const isWithinTime = cur >= from && cur <= to
        
        if (action === 'block') {
          return (isRightDay && isWithinTime) ? [rule] : []
        } else {
          return (!isRightDay || !isWithinTime) ? [rule] : []
        }
      }

      case 'date': {
        if (!rule.date?.date || !rule.date?.timeFrom || !rule.date?.timeTo) return []
        const action = rule.date.action || 'block'
        const ruleDate = new Date(rule.date.date)
        const isRightDay = now.toDateString() === ruleDate.toDateString()
        
        const [hFrom, mFrom] = rule.date.timeFrom.split(':').map(Number)
        const [hTo,   mTo  ] = rule.date.timeTo.split(':').map(Number)
        const cur = now.getHours() * 60 + now.getMinutes()
        
        const isWithinTime = cur >= (hFrom*60+mFrom) && cur <= (hTo*60+mTo)
        
        if (action === 'block') {
          return (isRightDay && isWithinTime) ? [rule] : []
        } else {
          return (!isRightDay || !isWithinTime) ? [rule] : []
        }
      }

      case 'monthly_date': {
        if (!rule.monthly_date?.day || !rule.monthly_date?.timeFrom || !rule.monthly_date?.timeTo) return []
        const action = rule.monthly_date.action || 'block'
        const isRightDay = now.getDate() === rule.monthly_date.day
        
        const [hFrom, mFrom] = rule.monthly_date.timeFrom.split(':').map(Number)
        const [hTo,   mTo  ] = rule.monthly_date.timeTo.split(':').map(Number)
        const cur = now.getHours() * 60 + now.getMinutes()
        
        const isWithinTime = cur >= (hFrom*60+mFrom) && cur <= (hTo*60+mTo)
        
        if (action === 'block') {
          return (isRightDay && isWithinTime) ? [rule] : []
        } else {
          return (!isRightDay || !isWithinTime) ? [rule] : []
        }
      }

      default: return []
    }
  })

  // ── Hosts file ──
  const webRules    = effectiveRules.filter(r => r.type === 'web')
  const domains     = webRules.flatMap(r => extractDomains(r.web || {}))
  applyHostsBlock(domains)

  // ── Process killer ──
  const programRules = effectiveRules.filter(r => r.type === 'program')
  const killedNames  = await enforceProcessRules(programRules, processes)
  if (killedNames.length > 0) {
    const uniqueNames = [...new Set(killedNames)]
    await sendAlert('process_killed', `Blocked: ${uniqueNames.join(', ')}`)
  }

  if (!hasPomodoro) {
    sendToWidget('hide')
  }
}

// ─── Subscribe to Firestore rules (per-device) ────────────────────────────────
function subscribeToRules() {
  log('📡 Subscribing to rules from Firestore...')

  const q = query(
    collection(db, 'users', parentUid, 'devices', deviceId, 'rules'),
    where('status', 'in', ['active', 'inactive'])
  )

  unsubRules = onSnapshot(
    q,
    (snap) => {
      activeRules = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      log(`📋 Received ${activeRules.length} rules (${activeRules.filter(r=>r.status==='active').length} active)`)
    },
    (err) => {
      log(`❌ Firestore error: ${err.message}`)
    }
  )
}

function subscribeToDevice() {
  if (!parentUid || !deviceId) return
  log('📡 Subscribing to device config from Firestore...')
  
  const deviceRef = doc(db, 'users', parentUid, 'devices', deviceId)
  unsubDevice = onSnapshot(deviceRef, async (snap) => {
    if (!snap.exists()) return
    deviceConfig = snap.data()
    
    if (deviceConfig.isLocked && !isWidgetLocked) {
      await ensureWidgetLocked()
    } else if (!deviceConfig.isLocked && isWidgetLocked) {
      const success = await sendToWidget('unlock')
      if (success) isWidgetLocked = false
    }
  }, (err) => {
    log(`❌ Firestore device config error: ${err.message}`)
  })
}

async function ensureWidgetLocked() {
  if (!deviceConfig || !deviceConfig.isLocked) return
  const msg = deviceConfig.lockMessage || 'Время вышло! Компьютер заблокирован.'
  const color = deviceConfig.lockColor || '#000000'
  const pin = deviceConfig.lockPin || ''
  const playSound = deviceConfig.playSound !== false ? '1' : '0'
  const readMessage = deviceConfig.readMessage ? '1' : '0'
  const readMessageRepeat = deviceConfig.readMessageRepeat ? '1' : '0'
  
  const success = await sendToWidget(`lock|${msg}|${color}|${pin}|${playSound}|${readMessage}|${readMessageRepeat}`)
  if (success) {
    isWidgetLocked = true
  } else {
    isWidgetLocked = false
  }
}

function subscribeToCommands() {
  if (!parentUid || !deviceId) return

  const commandsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'commands')
  const q = query(commandsRef, where('status', '==', 'pending'))

  unsubCommands = onSnapshot(
    q,
    async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const cmdDoc = change.doc
          const cmd = cmdDoc.data()
          // Support old 'type' and new 'action'
          const action = cmd.action || cmd.type
          log(`📥 Received command: ${action}`)
          
          try {
            await updateDoc(cmdDoc.ref, { status: 'processing' })
            
            const { exec } = require('child_process')
            const { promisify } = require('util')
            const execAsync = promisify(exec)

            if (action === 'uninstall' && cmd.uninstallCmd) {
              log(`🗑️  Uninstalling app: ${cmd.appId}...`)
              await execAsync(cmd.uninstallCmd, { timeout: 60000 })
              log(`✅ Uninstall command finished for ${cmd.appId}`)
              setTimeout(performProgramScan, 2000)
            } 
            else if (action === 'shutdown') {
              log(`🔴 Shutting down...`)
              await execAsync('shutdown /s /t 0')
            }
            else if (action === 'restart') {
              log(`🔄 Restarting...`)
              await execAsync('shutdown /r /t 0')
            }
            else if (action === 'sleep') {
              log(`🌙 Sleeping...`)
              await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
            }
            else if (action === 'hibernate') {
              log(`❄️ Hibernating...`)
              await execAsync('rundll32.exe powrprof.dll,SetSuspendState 1,1,0')
            }
            else if (action === 'lock') {
              log(`🔒 Locking screen...`)
              const msg = cmd.message || 'Время вышло! Компьютер заблокирован.'
              const color = cmd.color || '#000000'
              const pin = cmd.pin || ''
              const playSound = cmd.playSound !== false ? '1' : '0'
              const readMessage = cmd.readMessage ? '1' : '0'
              const readMessageRepeat = cmd.readMessageRepeat ? '1' : '0'
              sendToWidget(`lock|${msg}|${color}|${pin}|${playSound}|${readMessage}|${readMessageRepeat}`)
            }
            else if (action === 'unlock') {
              log(`🔓 Unlocking screen...`)
              sendToWidget(`unlock`)
            }
            else {
              throw new Error(`Unknown command action: ${action}`)
            }

            await updateDoc(cmdDoc.ref, { status: 'completed', completedAt: serverTimestamp() })
          } catch (err) {
            log(`❌ Command failed: ${err.message}`)
            await updateDoc(cmdDoc.ref, { status: 'failed', error: err.message, completedAt: serverTimestamp() })
          }
        }
      }
    },
    (err) => {
      log(`⚠️  Commands sync error: ${err.message}`)
    }
  )
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(reason) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`\n🛑 Stopping agent: ${reason}`)

  // Alert parent
  await sendAlert('agent_stopped', reason)

  // Mark device offline
  if (parentUid && deviceId) {
    try {
      await updateDoc(
        doc(db, 'users', parentUid, 'devices', deviceId),
        { status: 'offline', lastSeen: serverTimestamp() }
      )
    } catch {}
  }

  // Clear hosts blocks
  clearHostsBlock()

  // Stop timers
  clearInterval(heartbeatTimer)
  clearInterval(enforceTimer)
  clearInterval(updateTimer)
  if (unsubRules) unsubRules()
  if (unsubCommands) unsubCommands()

  log('✅ Agent stopped. Hosts blocks cleared.')
  process.exit(0)
}

// ─── Handle shutdown signals ───────────────────────────────────────────────────
process.on('SIGINT',  () => shutdown('SIGINT (Ctrl+C)'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', async (err) => {
  log(`💥 Uncaught exception: ${err.message}`)
  await sendAlert('agent_error', err.message)
  process.exit(1)
})

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('🛡️  KidsControlPC Agent v1.0.0 starting...')
  log(`💻 Host: ${hostname()}`)

  // 1. Load or run pairing
  const isService = process.argv.includes('--service')
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
    if (!isService) {
      log(`🔗 Paired with account. DeviceID: ${pairing.deviceId}`)
      log('✅ Agent is configured and running in background.')
      log('Terminal window will close in 3 seconds...')
      await new Promise(r => setTimeout(r, 3000))
      process.exit(0)
    } else {
      log(`🔗 Paired with account. DeviceID: ${pairing.deviceId}`)
    }
  }

  if (process.argv.includes('--pair-only') || isNewPairing) {
    if (isNewPairing) log('✅ Pairing complete! Window will close in 3 seconds, agent will continue in background...')
    else log('✅ Pairing complete. --pair-only flag detected, exiting.')
    await new Promise(r => setTimeout(r, 3000))
    process.exit(0)
  }

  parentUid = pairing.parentUid
  deviceId  = pairing.deviceId

  // 2. Send initial heartbeat
  await sendHeartbeat()
  log('💓 Heartbeat sent')
  
  await sendAlert('agent_started', 'Background program was started')

  // 3. Scan and upload installed programs
  await performProgramScan()

  // 4. Subscribe to rules and device
  subscribeToDevice()
  subscribeToRules()
  
  // Subscribe to remote commands
  subscribeToCommands()

  // Start widget listener
  startWidgetListener()

  // 5. Start heartbeat timer
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

  // 6. Start enforcing loop
  enforceTimer = setInterval(enforceRules, ENFORCE_INTERVAL_MS)
  
  // 5. Start auto-updater loop (check every 2 hours)
  updateTimer = setInterval(() => checkAndUpdateSilently(log), 2 * 60 * 60 * 1000)
  
  // Check for updates immediately on startup (with 10 sec delay so it doesn't interrupt initial sync)
  setTimeout(() => checkAndUpdateSilently(log), 10_000)

  log(`✅ Agent started and monitoring processes (DeviceID: ${deviceId})`)
  log(`✅ Agent active. Rule check interval: ${ENFORCE_INTERVAL_MS/1000}s.`)
  log('   Press Ctrl+C to stop.\n')
}

main().catch(async err => {
  console.error('❌ Fatal:', err.message)
  await sendAlert('agent_error', err.message).catch(() => {})
  process.exit(1)
})
