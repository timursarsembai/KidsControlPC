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

// ─── Init Firebase ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

let parentUid = null
let deviceId  = null
let activeRules = []           // current rules from Firestore
let unsubRules  = null         // Firestore listener unsubscribe
let heartbeatTimer = null
let enforceTimer   = null
let isShuttingDown = false

// Cached installed programs and their running states to minimize Firestore writes
let installedAppsCached = []
let runningStateCache = {}

// ─── Logging helper ───────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('ru-RU')
  console.log(`[${ts}] ${msg}`)
}

// ─── Heartbeat — update lastSeen in Firestore ─────────────────────────────────
async function sendHeartbeat() {
  if (!parentUid || !deviceId) return
  try {
    await updateDoc(
      doc(db, 'users', parentUid, 'devices', deviceId),
      { lastSeen: serverTimestamp(), status: 'online' }
    )
  } catch (err) {
    log(`⚠️  Heartbeat error: ${err.message}`)
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
  log('🔍 Сканирование установленных программ...')
  try {
    const apps = await getInstalledPrograms()
    installedAppsCached = apps
    log(`🔎 Найдено ${apps.length} программ. Загрузка в Firestore...`)

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
          running: false
        }, { merge: true })
      }
      await batch.commit()
    }
    log(`📤 Список программ успешно загружен (${apps.length} шт.)`)
  } catch (err) {
    log(`⚠️  Ошибка при сканировании/загрузке программ: ${err.message}`)
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
      log(`🔄 Обновлен статус работы для ${changedApps.length} программ`)
    } catch (err) {
      log(`⚠️  Ошибка обновления статуса программ: ${err.message}`)
    }
  }
}

// ─── Enforce rules ─────────────────────────────────────────────────────────────
async function enforceRules() {
  if (isShuttingDown) return

  // 1. Get running processes once to save CPU
  const processes = await getRunningProcesses()

  // 2. Update running status of apps in Firestore
  await updateRunningStatuses(processes)

  if (activeRules.length === 0) return

  // 3. Determine active rules (status === 'active' and within schedule/timer/date)
  const now = new Date()
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

      for (let i = 0; i < cyclesToLongBreak; i++) {
        if (blockElapsed < currentElapsed + workMs) {
          isWorkPhase = true
          break
        }
        currentElapsed += workMs
        
        const currentBreakMs = (i === cyclesToLongBreak - 1) ? longBreakMs : breakMs
        if (blockElapsed < currentElapsed + currentBreakMs) {
          isWorkPhase = false
          break
        }
        currentElapsed += currentBreakMs
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
        if (!rule.schedule?.weekdays || !rule.schedule?.timeFrom || !rule.schedule?.timeTo) return []
        const dayOfWeek = now.getDay()    // 0=Sun .. 6=Sat
        const mappedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1  // Mon=0..Sun=6
        if (!rule.schedule.weekdays.includes(mappedDay)) return []
        const [hFrom, mFrom] = rule.schedule.timeFrom.split(':').map(Number)
        const [hTo,   mTo  ] = rule.schedule.timeTo.split(':').map(Number)
        const cur = now.getHours() * 60 + now.getMinutes()
        const from = hFrom * 60 + mFrom
        const to   = hTo   * 60 + mTo
        return cur >= from && cur <= to ? [rule] : []
      }

      case 'date': {
        if (!rule.date?.date || !rule.date?.timeFrom || !rule.date?.timeTo) return []
        const ruleDate = new Date(rule.date.date)
        if (now.toDateString() !== ruleDate.toDateString()) return []
        const [hFrom, mFrom] = rule.date.timeFrom.split(':').map(Number)
        const [hTo,   mTo  ] = rule.date.timeTo.split(':').map(Number)
        const cur = now.getHours() * 60 + now.getMinutes()
        return cur >= (hFrom*60+mFrom) && cur <= (hTo*60+mTo) ? [rule] : []
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
    await sendAlert('process_killed', `Заблокировано: ${uniqueNames.join(', ')}`)
  }
}

// ─── Subscribe to Firestore rules (per-device) ────────────────────────────────
function subscribeToRules() {
  log('📡 Подписываюсь на правила из Firestore...')

  const q = query(
    collection(db, 'users', parentUid, 'devices', deviceId, 'rules'),
    where('status', 'in', ['active', 'inactive'])
  )

  unsubRules = onSnapshot(q, (snap) => {
    activeRules = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    log(`📋 Получено ${activeRules.length} правил (${activeRules.filter(r=>r.status==='active').length} активных)`)
    console.log(JSON.stringify(activeRules, null, 2))
  }, (err) => {
    log(`❌ Firestore error: ${err.message}`)
  })
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(reason) {
  if (isShuttingDown) return
  isShuttingDown = true

  log(`\n🛑 Остановка агента: ${reason}`)

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
  unsubRules?.()

  log('✅ Агент остановлен. hosts-блокировки сняты.')
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
  log('🛡️  KidsControlPC Agent v1.0.0 запускается...')
  log(`💻 Хост: ${hostname()}`)

  // 1. Load or run pairing
  let pairing = loadPairing()
  if (!pairing) {
    pairing = await runPairingFlow()
  } else {
    log(`🔗 Привязан к аккаунту. DeviceID: ${pairing.deviceId}`)
  }

  if (process.argv.includes('--pair-only')) {
    log('✅ Привязка завершена. Флаг --pair-only обнаружен, завершение работы.')
    process.exit(0)
  }

  parentUid = pairing.parentUid
  deviceId  = pairing.deviceId

  // 2. Send initial heartbeat
  await sendHeartbeat()
  log('💓 Heartbeat отправлен')

  // 3. Scan and upload installed programs
  await performProgramScan()

  // 4. Subscribe to rules
  subscribeToRules()

  // 5. Start heartbeat timer
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

  // 6. Start enforcement loop
  enforceTimer = setInterval(enforceRules, ENFORCE_INTERVAL_MS)

  log(`✅ Агент активен. Проверка правил каждые ${ENFORCE_INTERVAL_MS/1000}с.`)
  log('   Нажмите Ctrl+C для остановки.\n')
}

main().catch(async err => {
  console.error('❌ Fatal:', err.message)
  await sendAlert('agent_error', err.message).catch(() => {})
  process.exit(1)
})
