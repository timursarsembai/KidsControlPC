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

import { firebaseConfig, HEARTBEAT_INTERVAL_MS, ENFORCE_INTERVAL_MS, AGENT_VERSION } from './config.js'
import { loadPairing, runPairingFlow }    from './pairing.js'
import { applyHostsBlock, clearHostsBlock, extractDomains } from './hostsBlocker.js'
import { enforceProcessRules }            from './processEnforcer.js'
import { getInstalledPrograms, getRunningProcesses } from './scanner.js'
import { checkAndUpdateSilently }         from './updater.js'
import { processReminders }               from './reminder.js'
import { shouldBlockBySchedule }          from './ruleTiming.js'

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

let penaltyLockUntil = 0
let penaltyAttempts = 0
let lastPenaltyTime = 0
let lastPenaltyProgName = ''
let lastPomodoroStateKey = ''

import crypto from 'crypto'
import net from 'net'
import fs from 'fs'
import path from 'path'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const WIDGET_HOST = '127.0.0.1'
const WIDGET_PORT = 49152
const TIMER_WIDGET_TASK = 'KidsControlTimerWidget'
let isStartingTimerWidget = false
let lastTimerWidgetStartAttempt = 0
let ruleLockActive = false
let executedPowerRuleIds = new Set()

// ─── Logging helper ───────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function scanInstalledProgramsWithRetry(maxAttempts = 3, retryDelayMs = 30000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const apps = await getInstalledPrograms()
    if (apps.length > 0) {
      if (attempt > 1) {
        log(`Program scan recovered on attempt ${attempt}/${maxAttempts} (${apps.length} apps).`)
      }
      return apps
    }

    if (attempt < maxAttempts) {
      log(`Program scan returned 0 apps (attempt ${attempt}/${maxAttempts}). Retrying in ${Math.round(retryDelayMs / 1000)}s...`)
      await delay(retryDelayMs)
    }
  }

  return []
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
        { lastSeen: serverTimestamp(), status: 'online', agentVersion: AGENT_VERSION }
      ),
      timeoutPromise
    ])
    
    consecutiveFailures = 0 // reset on success
  } catch (err) {
    if (err.message.includes('RESOURCE_EXHAUSTED')) {
      log(`⚠️  Heartbeat error: Firebase quota exceeded. Backing off.`)
      consecutiveFailures = 0
    } else if (err.message.includes('NOT_FOUND')) {
      log(`⚠️  Heartbeat error: Device not found in Firestore. Backing off.`)
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

async function publishPomodoroState(state) {
  if (!parentUid || !deviceId) return

  const key = state
    ? [
        'active',
        state.phase,
        state.phaseEndsAtMs,
        state.startedAtMs,
        state.workDuration,
        state.breakDuration,
        state.longBreakDuration,
        state.cyclesToLongBreak
      ].join('|')
    : 'inactive'

  if (key === lastPomodoroStateKey) return

  const pomodoroState = state
    ? {
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
      }
    : {
        active: false,
        updatedAt: serverTimestamp()
      }

  try {
    await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), { pomodoroState })
    lastPomodoroStateKey = key
  } catch (err) {
    log(`⚠️  Pomodoro state sync error: ${err.message}`)
  }
}

const lastAlerts = {} // { [alertKey]: timestamp }

// ─── Send alert to parent ──────────────────────────────────────────────────────
async function sendAlert(type, details = '') {
  if (!parentUid) return
  
  // Debounce duplicate alerts for 60 seconds to prevent spam
  const alertKey = `${type}|${details}`
  const now = Date.now()
  if (lastAlerts[alertKey] && (now - lastAlerts[alertKey]) < 60000) {
    return // Skip sending if same alert was sent recently
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

// ─── Scan and upload installed programs ──────────────────────────────────────
async function performProgramScan() {
  log('🔍 Scanning installed programs...')
  try {
    const cacheFile = path.join(process.cwd(), 'programs_cache.json')
    let cachedApps = {}
    if (fs.existsSync(cacheFile)) {
      try {
        cachedApps = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      } catch(e) {
        log('⚠️  Failed to read programs_cache.json: ' + e.message)
      }
    }

    const apps = await scanInstalledProgramsWithRetry(3, 30000)
    const cachedCount = Object.keys(cachedApps).length
    if (apps.length === 0) {
      if (cachedCount > 0) {
        log(`⚠️  Program scan returned 0 apps, but cache has ${cachedCount}. Skipping sync to avoid accidental cleanup.`)
      } else {
        log('⚠️  Program scan returned 0 apps and cache is empty. Skipping sync, will retry later.')
      }
      return
    }

    installedAppsCached = apps

    const currentAppsMap = {}
    apps.forEach(a => { currentAppsMap[a.id] = a })

    const toUpdate = []
    const toDelete = []

    // Find new or modified apps
    for (const app of apps) {
      const cached = cachedApps[app.id]
      if (!cached || cached.name !== app.name || cached.path !== app.path || cached.version !== app.version) {
        toUpdate.push(app)
      }
    }

    // Find deleted apps
    for (const id in cachedApps) {
      if (!currentAppsMap[id]) {
        toDelete.push(id)
      }
    }

    if (toUpdate.length === 0 && toDelete.length === 0) {
      log(`🔎 Found ${apps.length} programs. No changes since last scan, skipping upload.`)
      return
    }

    log(`🔎 Found ${apps.length} programs. Uploading ${toUpdate.length} updates and ${toDelete.length} deletions...`)

    const col = collection(db, 'users', parentUid, 'devices', deviceId, 'installedApps')
    
    // Chunk upload to respect Firestore batch limit of 500 writes
    const ops = [...toUpdate.map(app => ({ type: 'update', app })), ...toDelete.map(id => ({ type: 'delete', id }))]
    const chunks = []
    for (let i = 0; i < ops.length; i += 400) {
      chunks.push(ops.slice(i, i + 400))
    }

    for (const chunk of chunks) {
      const batch = writeBatch(db)
      for (const op of chunk) {
        if (op.type === 'update') {
          const ref = doc(col, op.app.id)
          batch.set(ref, {
            name: op.app.name,
            path: op.app.path,
            publisher: op.app.publisher,
            version: op.app.version,
            uninstallCmd: op.app.uninstallCmd,
            running: false
          }, { merge: true })
        } else if (op.type === 'delete') {
          const ref = doc(col, op.id)
          batch.delete(ref)
        }
      }
      await batch.commit()
    }
    
    // Save new cache
    fs.writeFileSync(cacheFile, JSON.stringify(currentAppsMap), 'utf8')
    log(`📤 Program list successfully updated in Firestore.`)
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

function getTimerWidgetPath() {
  return process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'dist', 'TimerWidget.exe')
    : path.join(process.cwd(), 'TimerWidget.exe')
}

function isWidgetPortOpen(timeoutMs = 800) {
  return new Promise((resolve) => {
    const client = new net.Socket()
    const finish = (ok) => {
      client.destroy()
      resolve(ok)
    }
    client.setTimeout(timeoutMs)
    client.connect(WIDGET_PORT, WIDGET_HOST, () => finish(true))
    client.on('timeout', () => finish(false))
    client.on('error', () => finish(false))
  })
}

async function waitForWidgetPort(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isWidgetPortOpen()) return true
    await delay(300)
  }
  return false
}

function sendToWidgetOnce(message, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const client = new net.Socket()
    const finish = (ok) => {
      client.destroy()
      resolve(ok)
    }
    client.setTimeout(timeoutMs)
    client.connect(WIDGET_PORT, WIDGET_HOST, () => {
      client.write(message)
      finish(true)
    })
    client.on('timeout', () => finish(false))
    client.on('error', () => finish(false))
  })
}

async function startTimerWidgetIfNeeded() {
  if (await isWidgetPortOpen()) return true

  const now = Date.now()
  if (isStartingTimerWidget || now - lastTimerWidgetStartAttempt < 10000) {
    await delay(800)
    return isWidgetPortOpen()
  }

  isStartingTimerWidget = true
  lastTimerWidgetStartAttempt = now

  try {
    try {
      await execAsync(`schtasks /Run /TN "${TIMER_WIDGET_TASK}"`, { timeout: 5000, windowsHide: true })
      if (await waitForWidgetPort()) return true
    } catch (err) {
      log(`⚠️ TimerWidget scheduled task start failed: ${err.message}`)
    }

    if (process.argv.includes('--service')) {
      log('❌ TimerWidget is unavailable in the interactive user session. Not starting GUI from service session.')
      return false
    }

    const widgetExe = getTimerWidgetPath()
    if (fs.existsSync(widgetExe)) {
      const child = spawn(widgetExe, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
      child.unref()
      await delay(1000)
      return isWidgetPortOpen()
    }

    log(`⚠️ TimerWidget executable not found: ${widgetExe}`)
    return false
  } catch (err) {
    log(`❌ Failed to start TimerWidget: ${err.message}`)
    return false
  } finally {
    isStartingTimerWidget = false
  }
}

async function sendToWidget(message, options = {}) {
  const success = await sendToWidgetOnce(message)
  if (success || !options.ensureStarted) return success

  const started = await startTimerWidgetIfNeeded()
  if (!started) return false

  return sendToWidgetOnce(message)
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
function safeWidgetField(value) {
  return String(value ?? '').replace(/\|/g, '｜')
}

function getLockPayload(rule = {}) {
  return {
    message: rule.message || deviceConfig?.lockMessage || 'Время вышло! Компьютер заблокирован.',
    color: rule.color || deviceConfig?.lockColor || '#000000',
    pin: rule.pin ?? deviceConfig?.lockPin ?? '',
    playSound: rule.playSound !== undefined
      ? rule.playSound
      : deviceConfig?.playSound !== false,
    readMessage: rule.readMessage !== undefined
      ? rule.readMessage
      : Boolean(deviceConfig?.readMessage),
    readMessageRepeat: rule.readMessageRepeat !== undefined
      ? rule.readMessageRepeat
      : Boolean(deviceConfig?.readMessageRepeat)
  }
}

async function lockWidget(payload) {
  const playSound = payload.playSound !== false ? '1' : '0'
  const readMessage = payload.readMessage ? '1' : '0'
  const readMessageRepeat = payload.readMessageRepeat ? '1' : '0'
  const success = await sendToWidget(
    `lock|${safeWidgetField(payload.message)}|${safeWidgetField(payload.color)}|${safeWidgetField(payload.pin)}|${playSound}|${readMessage}|${readMessageRepeat}`,
    { ensureStarted: true }
  )
  if (success) isWidgetLocked = true
  return success
}

async function hideWidgetIfUnlocked() {
  if (deviceConfig?.isLocked || isWidgetLocked || Date.now() < penaltyLockUntil) return false
  return sendToWidget('hide')
}

async function enforceLockRules(lockRules) {
  if (lockRules.length > 0) {
    const success = await lockWidget(getLockPayload(lockRules[0]))
    if (success) ruleLockActive = true
    return
  }

  if (!ruleLockActive) return
  ruleLockActive = false

  if (deviceConfig?.isLocked || Date.now() < penaltyLockUntil) return
  const success = await sendToWidget('unlock')
  if (success || !(await isWidgetPortOpen())) {
    isWidgetLocked = false
  }
}

async function executePowerAction(action) {
  if (action === 'shutdown') {
    log(`🔴 Shutting down...`)
    await execAsync('shutdown /s /t 0')
  } else if (action === 'restart') {
    log(`🔄 Restarting...`)
    await execAsync('shutdown /r /t 0')
  } else if (action === 'sleep') {
    log(`🌙 Sleeping...`)
    await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
  } else if (action === 'hibernate') {
    log(`❄️ Hibernating...`)
    await execAsync('rundll32.exe powrprof.dll,SetSuspendState 1,1,0')
  } else {
    throw new Error(`Unknown power action: ${action}`)
  }
}

async function enforcePowerRules(powerRules) {
  const activeIds = new Set(powerRules.map(rule => rule.id || `${rule.action}:${rule.mode}`))
  executedPowerRuleIds = new Set([...executedPowerRuleIds].filter(id => activeIds.has(id)))

  for (const rule of powerRules) {
    const ruleId = rule.id || `${rule.action}:${rule.mode}`
    if (executedPowerRuleIds.has(ruleId)) continue
    executedPowerRuleIds.add(ruleId)

    try {
      await executePowerAction(rule.action)
    } catch (err) {
      log(`❌ Power rule failed (${rule.action}): ${err.message}`)
    }
  }
}

async function enforceRules() {
  if (isShuttingDown) return
  
  const nowMs = Date.now()
  if (penaltyLockUntil > 0 && nowMs >= penaltyLockUntil) {
    penaltyLockUntil = 0
    if (!deviceConfig?.isLocked) {
      await sendToWidget('unlock')
      isWidgetLocked = false
    } else {
      await ensureWidgetLocked()
    }
  }

  if ((deviceConfig?.isLocked || penaltyLockUntil > nowMs) && !isWidgetLocked) {
    if (penaltyLockUntil > nowMs) {
      const progName = lastPenaltyProgName || 'эту программу'
      const msg = `Не открывай ${progName}! Родители её запретили!`
      const success = await sendToWidget(`lock|${safeWidgetField(msg)}|#cc0000||1|1|1`, { ensureStarted: true })
      if (success) isWidgetLocked = true
    } else {
      await ensureWidgetLocked()
    }
  }

  // 1. Get running processes once to save CPU
  const processes = await getRunningProcesses()

  // 2. Update running status of apps in Firestore
  await updateRunningStatuses(processes)

  if (activeRules.length === 0) {
    await publishPomodoroState(null)
    await enforceLockRules([])
    await enforcePowerRules([])
    await hideWidgetIfUnlocked()
    return
  }

  // 3. Determine active rules (status === 'active' and within schedule/timer/date)
  const now = new Date()
  let hasPomodoro = false
  let pomodoroStateToPublish = null

  // Process reminders
  try {
    processReminders(activeRules)
  } catch (e) {
    log(`⚠️ Reminder error: ${e.message}`)
  }
  const effectiveRules = activeRules.flatMap(rule => {
    if (rule.status !== 'active') return []

    if (rule.type === 'pomodoro') {
      if (!rule.startedAt || !rule.workDuration || !rule.breakDuration) return []
      const startedAt = rule.startedAt?.toDate?.()
        || (typeof rule.startedAtClientMs === 'number' ? new Date(rule.startedAtClientMs) : new Date(rule.startedAt))
      const elapsed = Number(rule.elapsedBeforePauseMs || 0) + (now - startedAt)
      if (elapsed < 0) return []
      const workMs = rule.workDuration * 60 * 1000
      const breakMs = rule.breakDuration * 60 * 1000
      const longBreakMs = (rule.longBreakDuration || 15) * 60 * 1000
      const cyclesToLongBreak = rule.cyclesToLongBreak || 3

      const blockMs = (workMs + breakMs) * (cyclesToLongBreak - 1) + (workMs + longBreakMs)
      const blockElapsed = elapsed % blockMs

      let currentElapsed = 0
      let isWorkPhase = false
      let isLongBreak = false
      let phaseRemainingMs = 0

      for (let i = 0; i < cyclesToLongBreak; i++) {
        if (blockElapsed < currentElapsed + workMs) {
          isWorkPhase = true
          isLongBreak = false
          phaseRemainingMs = (currentElapsed + workMs) - blockElapsed
          break
        }
        currentElapsed += workMs
        
        const currentBreakMs = (i === cyclesToLongBreak - 1) ? longBreakMs : breakMs
        if (blockElapsed < currentElapsed + currentBreakMs) {
          isWorkPhase = false
          isLongBreak = i === cyclesToLongBreak - 1
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
      sendToWidget(`show|${phaseStr}|${rMinStr}:${rSecStr}`, { ensureStarted: true })
      pomodoroStateToPublish = {
        phase: isWorkPhase ? 'work' : (isLongBreak ? 'long-break' : 'break'),
        isWorkPhase,
        phaseEndsAtMs: now.getTime() + phaseRemainingMs,
        startedAtMs: startedAt.getTime(),
        workDuration: rule.workDuration,
        breakDuration: rule.breakDuration,
        longBreakDuration: rule.longBreakDuration || 15,
        cyclesToLongBreak
      }

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
        if (!rule.schedule) return []
        return shouldBlockBySchedule(rule.schedule, now) ? [rule] : []
      }

      case 'profile': {
        if (rule.type === 'profile_config' || !rule.schedule) return []
        return shouldBlockBySchedule(rule.schedule, now) ? [rule] : []
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
  const lockRules = effectiveRules.filter(r => r.type === 'lock')
  await publishPomodoroState(hasPomodoro ? pomodoroStateToPublish : null)
  if (!hasPomodoro && lockRules.length === 0) {
    await hideWidgetIfUnlocked()
  }

  await enforceLockRules(lockRules)

  const powerRules = effectiveRules.filter(r => r.type === 'power')
  await enforcePowerRules(powerRules)

  const webRules    = effectiveRules.filter(r => r.type === 'web')
  const domains     = webRules.flatMap(r => extractDomains(r.web || {}))
  applyHostsBlock(domains)

  // ── Process killer ──
  const programRules = effectiveRules.filter(r => r.type === 'program')
  const killedEvents = await enforceProcessRules(programRules, processes)
  if (killedEvents.length > 0) {
    const uniqueNames = [...new Set(killedEvents.map(k => k.name))]
    await sendAlert('process_killed', `Blocked: ${uniqueNames.join(', ')}`)

    // Spam protection: penalty lock (only for interactive launches with visible windows)
    const interactiveKills = killedEvents.filter(k => k.interactive)
    if (interactiveKills.length === 0) {
      return
    }

    const nowMs = Date.now()
    if (nowMs >= penaltyLockUntil) {
      if (nowMs - lastPenaltyTime <= 5 * 60 * 1000) {
        penaltyAttempts++
      } else {
        penaltyAttempts = 1
      }
      lastPenaltyTime = nowMs

      if (penaltyAttempts >= 5) {
        // Use old widget for shutdown message or maybe we don't need a widget, just alert parent and shutdown
        await sendAlert('agent_error', 'Слишком много попыток запуска заблокированных программ. Выключение ПК.')
        exec('shutdown /s /t 0')
        return
      }

      const lockSeconds = penaltyAttempts * 30
      penaltyLockUntil = nowMs + (lockSeconds * 1000)
      lastPenaltyProgName = interactiveKills[0].name || uniqueNames[0]

      const msg = `Не открывай ${lastPenaltyProgName}! Родители её запретили!`
      
      
      const widgetExe = process.env.NODE_ENV === 'development' 
        ? path.join(process.cwd(), 'dist', 'ScreenBlockerWidget.exe')
        : path.join(process.cwd(), 'ScreenBlockerWidget.exe')

      const msgBase64 = Buffer.from(msg, 'utf8').toString('base64')
      try {
        const child = spawn(widgetExe, [msgBase64, lockSeconds.toString()], {
          detached: true,
          stdio: 'ignore'
        })
        child.unref()
      } catch (err) {
        log('❌ Failed to spawn ScreenBlockerWidget: ' + err.message)
      }
    }
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
      if (Date.now() < penaltyLockUntil) return // Don't unlock if penalty is active
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
  
  const success = await sendToWidget(
    `lock|${safeWidgetField(msg)}|${safeWidgetField(color)}|${safeWidgetField(pin)}|${playSound}|${readMessage}|${readMessageRepeat}`,
    { ensureStarted: true }
  )
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
            
            if (action === 'uninstall' && cmd.uninstallCmd) {
              log(`🗑️  Uninstalling app: ${cmd.appId}...`)
              await execAsync(cmd.uninstallCmd, { timeout: 60000 })
              log(`✅ Uninstall command finished for ${cmd.appId}`)
              setTimeout(performProgramScan, 2000)
            } 
            else if (action === 'shutdown') {
              log(`🔴 Shutting down...`)
              await executePowerAction('shutdown')
            }
            else if (action === 'restart') {
              log(`🔄 Restarting...`)
              await executePowerAction('restart')
            }
            else if (action === 'sleep') {
              log(`🌙 Sleeping...`)
              await executePowerAction('sleep')
            }
            else if (action === 'hibernate') {
              log(`❄️ Hibernating...`)
              await executePowerAction('hibernate')
            }
            else if (action === 'lock') {
              log(`🔒 Locking screen...`)
              const msg = cmd.message || 'Время вышло! Компьютер заблокирован.'
              const color = cmd.color || '#000000'
              const pin = cmd.pin || ''
              const playSound = cmd.playSound !== false ? '1' : '0'
              const readMessage = cmd.readMessage ? '1' : '0'
              const readMessageRepeat = cmd.readMessageRepeat ? '1' : '0'
              const success = await sendToWidget(
                `lock|${safeWidgetField(msg)}|${safeWidgetField(color)}|${safeWidgetField(pin)}|${playSound}|${readMessage}|${readMessageRepeat}`,
                { ensureStarted: true }
              )
              if (success) isWidgetLocked = true
            }
            else if (action === 'unlock') {
              log(`🔓 Unlocking screen...`)
              const success = await sendToWidget(`unlock`)
              if (success) isWidgetLocked = false
            }
            else if (action === 'update_agent') {
              log(`🔄 Force updating agent...`)
              // Do not wait, because it might call process.exit()
              checkAndUpdateSilently(log, true)
            }
            else if (action === 'force_update') {
              log(`🔄 Force update requested from parent...`)
              checkAndUpdateSilently(log)
            }
            else {
              log(`⚠️ Unknown command action: ${action}`)
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
  log(`🛡️  KidsControlPC Agent v${AGENT_VERSION} starting...`)
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
  
  // Re-scan after startup burst to avoid empty scan results on cold boot
  setTimeout(() => {
    if (!isShuttingDown) {
      log('🔁 Running delayed startup program re-scan...')
      performProgramScan().catch(err => log(`⚠️  Delayed scan failed: ${err.message}`))
    }
  }, 3 * 60 * 1000)

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
