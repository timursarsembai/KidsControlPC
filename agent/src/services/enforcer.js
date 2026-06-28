import path from 'path'
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { getDeviceConfig, getActiveRules, getParentConfig } from '../core/configManager.js'
import { getRunningProcesses } from '../scanner.js'
import { processReminders } from '../reminder.js'
import { enforceProcessRules } from '../processEnforcer.js'
import { extractDomains, applyHostsBlock } from '../hostsBlocker.js'
import { sendAlert, db } from '../network/firebaseSync.js'
import { evaluatePomodoroState } from './pomodoroEngine.js'
import { executePowerAction } from './powerActions.js'
import {
  getEffectiveRules,
  logEffectiveProgramRules,
  logProfileRuleDebug
} from './ruleEvaluator.js'
import {
  handleInteractiveKillPenalty,
  hideWidgetIfUnlocked,
  syncPenaltyLockState
} from './penaltyManager.js'
import { trackAppDelta, trackBlockedDomains } from './activityTracker.js'
import { getLastCacheDomains } from './dnsTracker.js'

const POWER_ACTIONS = new Set(['shutdown', 'restart', 'sleep', 'hibernate'])

let executedPowerRuleIds = new Set()
let runningStateCache = {}
let isEnforcing = false

function log(msg) {
  console.log(`[Enforcer] ${msg}`)
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

export async function enforceRules(parentUid, deviceId, isShuttingDown) {
  if (isShuttingDown || isEnforcing) return
  isEnforcing = true
  try {
    await _enforceRules(parentUid, deviceId)
  } finally {
    isEnforcing = false
  }
}

async function _enforceRules(parentUid, deviceId) {
  const parentConfig = getParentConfig()
  if (parentConfig?.pauseAllRules) {
    applyHostsBlock([])
    return
  }

  const deviceConfig = getDeviceConfig()
  const activeRules = getActiveRules()
  const nowMs = Date.now()

  await syncPenaltyLockState(deviceConfig, nowMs)

  const processes = await getRunningProcesses()
  await updateRunningStatuses(parentUid, deviceId, processes)
  await trackAppDelta(processes, parentUid, deviceId).catch(e => log(`trackAppDelta error: ${e.message}`))

  evaluatePomodoroState()

  if (activeRules.length === 0) {
    await hideWidgetIfUnlocked(deviceConfig, nowMs)
    return
  }

  const now = new Date()

  try {
    processReminders(activeRules)
  } catch (e) {}

  logProfileRuleDebug(activeRules, now, log)

  const effectiveRules = getEffectiveRules(activeRules, deviceConfig, now)
  logEffectiveProgramRules(effectiveRules, log)

  const powerRules = effectiveRules.filter(r => r.type === 'power')
  const activePowerIds = new Set(powerRules.map(rule => rule.id || `${rule.action}:${rule.mode}`))
  executedPowerRuleIds = new Set([...executedPowerRuleIds].filter(id => activePowerIds.has(id)))
  for (const rule of powerRules) {
    if (!POWER_ACTIONS.has(rule.action)) continue
    const ruleId = rule.id || `${rule.action}:${rule.mode}`
    if (executedPowerRuleIds.has(ruleId)) continue
    executedPowerRuleIds.add(ruleId)
    executePowerAction(rule.action, log).catch(err => log(`Power rule failed: ${err.message}`))
  }

  const webRules = effectiveRules.filter(r => r.type === 'web')
  const domains = webRules.flatMap(r => extractDomains(r.web || {}))
  applyHostsBlock(domains)
  if (domains.length) {
    const visitedBlockedDomains = domains.filter(d => getLastCacheDomains().has(d))
    if (visitedBlockedDomains.length)
      trackBlockedDomains(visitedBlockedDomains, parentUid, deviceId).catch(e => log(`trackBlockedDomains error: ${e.message}`))
  }

  const programRules = effectiveRules.filter(r => r.type === 'program')
  const killedEvents = await enforceProcessRules(programRules, processes)
  if (killedEvents.length === 0) return

  const uniqueNames = [...new Set(killedEvents.map(k => k.name))]
  await sendAlert('process_killed', `Blocked: ${uniqueNames.join(', ')}`)

  const shouldStop = await handleInteractiveKillPenalty(killedEvents, uniqueNames, nowMs, sendAlert, log)
  if (shouldStop) return
}
