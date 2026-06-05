import { getDeviceConfig, getActiveRules } from '../core/configManager.js'
import { eventBus, EVENTS } from '../core/eventBus.js'
import { getRunningProcesses } from '../scanner.js'
import { shouldBlockBySchedule } from '../ruleTiming.js'
import { processReminders } from '../reminder.js'
import { enforceProcessRules } from '../processEnforcer.js'
import { extractDomains, applyHostsBlock, clearHostsBlock } from '../hostsBlocker.js'
import { evaluatePomodoroState } from './pomodoroEngine.js'
import { sendAlert, db } from '../network/firebaseSync.js'
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { execAsync } from '../core/utils.js'
import { spawn } from 'child_process'
import path from 'path'
import { sendToWidget, ensureWidgetLocked, checkWidgetSessionHealth, getIsWidgetLocked, setIsWidgetLocked } from './widgetManager.js'

let penaltyLockUntil = 0
let penaltyAttempts = 0
let lastPenaltyTime = 0
let lastPenaltyProgName = ''

let executedPowerRuleIds = new Set()
let runningStateCache = {}

function log(msg) {
  console.log(`[Enforcer] ${msg}`)
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
  }
}

async function updateRunningStatuses(parentUid, deviceId, currentProcesses) {
  if (!parentUid || !deviceId) return
  const currentPBases = currentProcesses.map(p => p.base)
  const currentPNames = currentProcesses.map(p => p.name)
  const activeRules = getActiveRules()
  
  for (const rule of activeRules) {
    if (rule.type !== 'program' || !rule.program || !rule.program.name) continue
    const rulePathLow = (rule.program.executablePath || '').toLowerCase()
    const ruleNameLow = rule.program.name.toLowerCase()
    const ruleBase = rulePathLow ? path.basename(rulePathLow, '.exe') : ruleNameLow.replace(/\.exe$/, '')

    const isRunning = currentPBases.includes(ruleBase) || currentPNames.includes(ruleNameLow)
    
    if (runningStateCache[rule.id] !== isRunning) {
      runningStateCache[rule.id] = isRunning
      try {
        await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId, 'rules', rule.id), {
          isRunning,
          lastSeenRunningAt: isRunning ? serverTimestamp() : null
        })
      } catch (err) { }
    }
  }
}

async function hideWidgetIfUnlocked() {
  const deviceConfig = getDeviceConfig()
  if (!deviceConfig?.isLocked && penaltyLockUntil < Date.now()) {
    await sendToWidget({ command: 'hide' }, { ensureStarted: false })
  }
}

export async function enforceRules(parentUid, deviceId, isShuttingDown) {
  if (isShuttingDown) return
  
  const deviceConfig = getDeviceConfig()
  const activeRules = getActiveRules()

  await checkWidgetSessionHealth()
  
  const nowMs = Date.now()
  const isWidgetLocked = getIsWidgetLocked()

  if (penaltyLockUntil > 0 && nowMs >= penaltyLockUntil) {
    penaltyLockUntil = 0
    if (!deviceConfig?.isLocked) {
      await sendToWidget({ command: 'unlock' })
      setIsWidgetLocked(false)
    } else {
      await ensureWidgetLocked()
    }
  }

  if ((deviceConfig?.isLocked || penaltyLockUntil > nowMs) && !isWidgetLocked) {
    if (penaltyLockUntil > nowMs) {
      const progName = lastPenaltyProgName || 'эту программу'
      const msg = `Не открывай ${progName}! Родители её запретили!`
      const msgBase64 = Buffer.from(msg, 'utf8').toString('base64')
      
      const success = await sendToWidget(
        { command: 'lock', message: msg, color: '#cc0000', pin: '', playSound: true, readMessage: true, readMessageRepeat: true },
        { ensureStarted: true }
      )
      if (success) setIsWidgetLocked(true)
    } else {
      await ensureWidgetLocked()
    }
  }

  // 1. Get running processes
  const processes = await getRunningProcesses()

  // 2. Update running status
  await updateRunningStatuses(parentUid, deviceId, processes)

  // 3. Evaluate pomodoro
  evaluatePomodoroState()

  if (activeRules.length === 0) {
    await hideWidgetIfUnlocked()
    return
  }

  const now = new Date()

  // Process reminders
  try {
    processReminders(activeRules)
  } catch (e) {}

  const effectiveRules = activeRules.flatMap(rule => {
    if (rule.status !== 'active') return []

    // pomodoro virtual rules are handled by evaluatePomodoroState, but we need to block programs
    // We'll skip virtual pomodoro rule logic here and let pomodoroEngine handle UI.
    // Wait, the agent.js creates virtual rules to block apps during pomodoro work phase.
    // I should extract that too. Let's do that below.

    switch (rule.mode) {
      case 'permanent': return [rule]
      case 'timer': {
        if (!rule.timer?.startedAt || !rule.timer?.duration) return []
        const startedAt  = rule.timer.startedAt?.toDate?.() || new Date(rule.timer.startedAt)
        const durationMs = Number(rule.timer.duration) * 60 * 1000
        return (now - startedAt) < durationMs ? [rule] : []
      }
      case 'schedule':
      case 'profile': {
        if (!rule.schedule) return []
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
        if (action === 'block') return (isRightDay && isWithinTime) ? [rule] : []
        else return (!isRightDay || !isWithinTime) ? [rule] : []
      }
      default: return []
    }
  })

  // Add virtual rules for active Pomodoro
  if (deviceConfig?.pomodoroState?.active && deviceConfig?.pomodoroState?.isWorkPhase) {
    const pRule = activeRules.find(r => r.type === 'pomodoro' && r.status === 'active')
    if (pRule) {
      if (pRule.targets?.programs) {
        pRule.targets.programs.forEach(pName => {
          effectiveRules.push({ type: 'program', program: { name: pName } })
        })
      }
      if (pRule.targets?.websites) {
        pRule.targets.websites.forEach(wUrl => {
          effectiveRules.push({ type: 'web', web: { resolvedPattern: wUrl } })
        })
      }
    }
  }

  // Enforce Power
  const powerRules = effectiveRules.filter(r => r.type === 'power')
  const activePowerIds = new Set(powerRules.map(rule => rule.id || `${rule.action}:${rule.mode}`))
  executedPowerRuleIds = new Set([...executedPowerRuleIds].filter(id => activePowerIds.has(id)))
  for (const rule of powerRules) {
    const ruleId = rule.id || `${rule.action}:${rule.mode}`
    if (executedPowerRuleIds.has(ruleId)) continue
    executedPowerRuleIds.add(ruleId)
    executePowerAction(rule.action).catch(err => log(`Power rule failed: ${err.message}`))
  }

  // Enforce Web
  const webRules = effectiveRules.filter(r => r.type === 'web')
  const domains = webRules.flatMap(r => extractDomains(r.web || {}))
  applyHostsBlock(domains)

  // Enforce Process Kills
  const programRules = effectiveRules.filter(r => r.type === 'program')
  const killedEvents = await enforceProcessRules(programRules, processes)
  if (killedEvents.length > 0) {
    const uniqueNames = [...new Set(killedEvents.map(k => k.name))]
    await sendAlert('process_killed', `Blocked: ${uniqueNames.join(', ')}`)

    const interactiveKills = killedEvents.filter(k => k.interactive)
    if (interactiveKills.length > 0) {
      if (nowMs >= penaltyLockUntil) {
        if (nowMs - lastPenaltyTime <= 5 * 60 * 1000) penaltyAttempts++
        else penaltyAttempts = 1
        lastPenaltyTime = nowMs

        if (penaltyAttempts >= 5) {
          await sendAlert('agent_error', 'Слишком много попыток запуска заблокированных программ. Выключение ПК.')
          execAsync('shutdown /s /t 0')
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
}
