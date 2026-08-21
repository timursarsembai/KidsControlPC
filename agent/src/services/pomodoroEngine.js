import { eventBus, EVENTS } from '../core/eventBus.js'
import { getDeviceConfig } from '../core/configManager.js'
import { sendToWidget } from './widgetManager.js'
import { publishPomodoroState } from '../network/firebaseSync.js'

let lastPomodoroStateKey = ''

export function evaluatePomodoroState() {
  const deviceConfig = getDeviceConfig()
  if (!deviceConfig) return
  
  const state = deviceConfig.pomodoroState

  // 1. If pomodoro is inactive or locked, hide it
  if (!state || !state.active || deviceConfig.isLocked) {
    if (lastPomodoroStateKey !== '') {
      sendToWidget({ command: 'hide' }, { ensureStarted: false })
      publishPomodoroState(null)
      lastPomodoroStateKey = ''
      eventBus.emit(EVENTS.POMODORO_INACTIVE)
    }
    return
  }

  // 2. Active pomodoro
  const nowMs = Date.now()
  const elapsed = nowMs - state.startedAtMs
  const workMs = state.workDuration * 60 * 1000
  const breakMs = state.breakDuration * 60 * 1000
  const longBreakMs = (state.longBreakDuration || 15) * 60 * 1000
  const cyclesToLongBreak = state.cyclesToLongBreak || 3

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
  
  const rSec = Math.floor(phaseRemainingMs / 1000)
  const rMinStr = Math.floor(rSec / 60).toString().padStart(2, '0')
  const rSecStr = (rSec % 60).toString().padStart(2, '0')
  const phaseStr = isWorkPhase ? 'Фокус (Работа)' : 'Пауза (Отдых)'
  
  sendToWidget({ command: 'show', phase: phaseStr, time: `${rMinStr}:${rSecStr}` }, { ensureStarted: true })
  
  const currentPhase = isWorkPhase ? 'work' : (isLongBreak ? 'long-break' : 'break')
  
  const pomodoroStateToPublish = {
    phase: currentPhase,
    isWorkPhase,
    phaseEndsAtMs: nowMs + phaseRemainingMs,
    startedAtMs: state.startedAtMs,
    workDuration: state.workDuration,
    breakDuration: state.breakDuration,
    longBreakDuration: state.longBreakDuration,
    cyclesToLongBreak: state.cyclesToLongBreak
  }

  const key = [
    'active',
    pomodoroStateToPublish.phase,
    pomodoroStateToPublish.phaseEndsAtMs,
    pomodoroStateToPublish.startedAtMs,
    pomodoroStateToPublish.workDuration,
    pomodoroStateToPublish.breakDuration,
    pomodoroStateToPublish.longBreakDuration,
    pomodoroStateToPublish.cyclesToLongBreak
  ].join('|')

  if (key !== lastPomodoroStateKey) {
    publishPomodoroState(pomodoroStateToPublish)
    lastPomodoroStateKey = key
    eventBus.emit(EVENTS.POMODORO_PHASE_CHANGED, pomodoroStateToPublish)
  }
}
