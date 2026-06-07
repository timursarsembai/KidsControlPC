import path from 'path'
import { spawn } from 'child_process'
import { execAsync } from '../core/utils.js'
import {
  sendToWidget,
  ensureWidgetLocked,
  checkWidgetSessionHealth,
  getIsWidgetLocked,
  setIsWidgetLocked
} from './widgetManager.js'

let penaltyLockUntil = 0
let penaltyAttempts = 0
let lastPenaltyTime = 0
let lastPenaltyProgName = ''

export function isPenaltyActive(nowMs = Date.now()) {
  return penaltyLockUntil > nowMs
}

export async function hideWidgetIfUnlocked(deviceConfig, nowMs = Date.now()) {
  if (!deviceConfig?.isLocked && penaltyLockUntil < nowMs) {
    await sendToWidget({ command: 'hide' }, { ensureStarted: false })
  }
}

export async function syncPenaltyLockState(deviceConfig, nowMs = Date.now()) {
  await checkWidgetSessionHealth()

  const isWidgetLocked = getIsWidgetLocked()

  if (!deviceConfig?.isLocked && penaltyLockUntil <= nowMs && isWidgetLocked) {
    await sendToWidget({ command: 'unlock' })
    setIsWidgetLocked(false)
  }

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

      const success = await sendToWidget(
        { command: 'lock', message: msg, color: '#cc0000', pin: '', playSound: true, readMessage: true, readMessageRepeat: true },
        { ensureStarted: true }
      )
      if (success) setIsWidgetLocked(true)
    } else {
      await ensureWidgetLocked()
    }
  }
}

export async function handleInteractiveKillPenalty(killedEvents, uniqueNames, nowMs, sendAlert, log) {
  const interactiveKills = killedEvents.filter(k => k.interactive)
  if (interactiveKills.length === 0) return false
  if (nowMs < penaltyLockUntil) return false

  if (nowMs - lastPenaltyTime <= 5 * 60 * 1000) penaltyAttempts++
  else penaltyAttempts = 1
  lastPenaltyTime = nowMs

  if (penaltyAttempts >= 5) {
    await sendAlert('agent_error', 'Слишком много попыток запуска заблокированных программ. Выключение ПК.')
    execAsync('shutdown /s /t 0')
    return true
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

  return false
}
