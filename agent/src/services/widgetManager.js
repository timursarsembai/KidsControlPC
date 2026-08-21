import net from 'net'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { eventBus, EVENTS } from '../core/eventBus.js'
import { getDeviceConfig } from '../core/configManager.js'

let isWidgetLocked = false
let isStartingTimerWidget = false
let lastTimerWidgetStartAttempt = 0
let lastWidgetSessionCheck = 0

// We import execAsync, delay, getSessionIdsForProcess from utils (will create utils.js)
import { execAsync, delay, getSessionIdsForProcess, runEncodedPS } from '../core/utils.js'

const TIMER_WIDGET_TASK = 'KidsControlTimerWidget'

function log(msg) {
  console.log(`[WidgetManager] ${msg}`)
}

export function getTimerWidgetPath() {
  return process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'dist', 'TimerWidget.exe')
    : path.join(process.cwd(), 'TimerWidget.exe')
}

export async function isWidgetPortOpen() {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(2000)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => {
      resolve(false)
    })
    socket.connect('\\\\.\\pipe\\KidsControlTimerPipe')
  })
}

export async function isWidgetInCorrectSession() {
  try {
    const widgetSessions = await getSessionIdsForProcess('TimerWidget.exe')
    const explorerSessions = await getSessionIdsForProcess('explorer.exe')
    
    if (widgetSessions.size === 0 || explorerSessions.size === 0) return false
    
    for (const ws of widgetSessions) {
      if (explorerSessions.has(ws)) return true
    }
    return false
  } catch {
    return false // Force restart on error
  }
}

export async function killTimerWidget() {
  try {
    await execAsync('taskkill /F /IM TimerWidget.exe', { timeout: 5000, windowsHide: true })
  } catch { /* may already be dead */ }
  await delay(800) // wait for port to be released
}

async function launchWidgetInUserSession(widgetExe) {
  const escapedPath = widgetExe.replace(/'/g, "''")
  const psLines = [
    "$explorer = Get-CimInstance Win32_Process -Filter \"Name = 'explorer.exe'\" -EA SilentlyContinue | Select -First 1",
    'if (-not $explorer) { exit 1 }',
    '$owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner',
    '$userId = \"$($owner.Domain)\\$($owner.User)\"',
    `$action = New-ScheduledTaskAction -Execute '${escapedPath}'`,
    '$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    "Register-ScheduledTask -TaskName 'KCWidgetRestart' -Action $action -Principal $principal -Settings $settings -Force | Out-Null",
    "Start-ScheduledTask -TaskName 'KCWidgetRestart'",
    'Start-Sleep -Seconds 3',
    "Unregister-ScheduledTask -TaskName 'KCWidgetRestart' -Confirm:$false -EA SilentlyContinue"
  ]
  const psScript = psLines.join('\n')
  await runEncodedPS(psScript, 25000)
}

async function waitForWidgetPort(timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isWidgetPortOpen()) return true
    await delay(500)
  }
  return false
}

export async function startTimerWidgetIfNeeded() {
  const portOpen = await isWidgetPortOpen()

  if (portOpen) {
    if (!process.argv.includes('--service')) return true
    const sessionOk = await isWidgetInCorrectSession()
    if (sessionOk) return true
    log('⚠️ TimerWidget running in wrong session (invisible). Killing for restart...')
    await killTimerWidget()
  }

  const now = Date.now()
  if (isStartingTimerWidget || now - lastTimerWidgetStartAttempt < 10000) {
    await delay(800)
    return isWidgetPortOpen()
  }

  isStartingTimerWidget = true
  lastTimerWidgetStartAttempt = now

  const widgetExe = getTimerWidgetPath()
  if (!fs.existsSync(widgetExe)) {
    log(`⚠️ TimerWidget executable not found: ${widgetExe}`)
    isStartingTimerWidget = false
    return false
  }

  try {
    try {
      await execAsync(`schtasks /Run /TN "${TIMER_WIDGET_TASK}"`, { timeout: 5000, windowsHide: true })
      if (await waitForWidgetPort(6000)) {
        if (!process.argv.includes('--service') || await isWidgetInCorrectSession()) {
          isStartingTimerWidget = false
          return true
        } else {
          await killTimerWidget()
        }
      }
    } catch {}

    if (process.argv.includes('--service')) {
      await launchWidgetInUserSession(widgetExe)
    } else {
      const child = spawn(widgetExe, [], { detached: true, stdio: 'ignore' })
      child.unref()
    }

    const success = await waitForWidgetPort(10000)
    isStartingTimerWidget = false
    return success
  } catch (err) {
    log(`❌ Failed to start TimerWidget: ${err.message}`)
    isStartingTimerWidget = false
    return false
  }
}

export async function sendToWidget(payload, options = {}) {
  const { ensureStarted = false } = options
  
  if (ensureStarted) {
    const isRunning = await startTimerWidgetIfNeeded()
    if (!isRunning) {
      log('⚠️ Cannot send command to widget: widget is not running')
      return false
    }
  } else {
    if (!(await isWidgetPortOpen())) return false
  }

  return new Promise((resolve) => {
    const client = new net.Socket()
    client.setTimeout(3000)

    client.on('error', (err) => {
      log(`⚠️ TimerWidget connection error: ${err.message}`)
      client.destroy()
      resolve(false)
    })

    client.on('timeout', () => {
      log('⚠️ TimerWidget connection timeout')
      client.destroy()
      resolve(false)
    })

    client.connect('\\\\.\\pipe\\KidsControlTimerPipe', () => {
      const jsonStr = JSON.stringify(payload) + '\n'
      client.write(jsonStr, () => {
        client.end()
        resolve(true)
      })
    })
  })
}

export async function ensureWidgetLocked() {
  const deviceConfig = getDeviceConfig()
  if (!deviceConfig || !deviceConfig.isLocked) return

  const msg = deviceConfig.lockMessage || 'Время вышло! Компьютер заблокирован.'
  const color = deviceConfig.lockColor || '#000000'
  const pin = deviceConfig.lockPin || ''
  const playSound = deviceConfig.playSound !== false
  const readMessage = deviceConfig.readMessage || false
  const readMessageRepeat = deviceConfig.readMessageRepeat || false
  
  const success = await sendToWidget(
    { command: 'lock', message: msg, color, pin, playSound, readMessage, readMessageRepeat },
    { ensureStarted: true }
  )
  if (success) {
    isWidgetLocked = true
    eventBus.emit(EVENTS.WIDGET_LOCKED)
  } else {
    isWidgetLocked = false
  }
}

export async function checkWidgetSessionHealth() {
  if (!isWidgetLocked || !process.argv.includes('--service')) return
  const now = Date.now()
  if (now - lastWidgetSessionCheck > 60000) {
    lastWidgetSessionCheck = now
    const ok = await isWidgetInCorrectSession()
    if (!ok) {
      log('⚠️ TimerWidget in wrong session during lock. Killing for restart...')
      await killTimerWidget()
      isWidgetLocked = false
      eventBus.emit(EVENTS.WIDGET_UNLOCKED, { reason: 'session_health_failed' })
      await delay(500)
    }
  }
}

export function getIsWidgetLocked() {
  return isWidgetLocked
}

export function setIsWidgetLocked(locked) {
  isWidgetLocked = locked
}

// Subscribe to events
eventBus.on(EVENTS.LOCK_REQUESTED, () => {
  ensureWidgetLocked()
})

eventBus.on(EVENTS.UNLOCK_REQUESTED, async () => {
  const success = await sendToWidget({ command: 'unlock' })
  if (success) {
    isWidgetLocked = false
    eventBus.emit(EVENTS.WIDGET_UNLOCKED, { reason: 'manual_unlock' })
  }
})
