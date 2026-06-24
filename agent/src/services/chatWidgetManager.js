import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { execAsync, delay, getSessionIdsForProcess, runEncodedPS } from '../core/utils.js'
import { CHAT_DATA_DIR } from '../config.js'

const CHAT_APP_EXE = 'ChatTrayApp.exe'
let isLaunching = false
let lastLaunchAttempt = 0

function log(msg) {
  console.log('[ChatWidget] ' + msg)
}

function getChatAppPath() {
  return process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'dist', CHAT_APP_EXE)
    : path.join(process.cwd(), CHAT_APP_EXE)
}

async function isChatAppRunningInUserSession() {
  try {
    const appSessions = await getSessionIdsForProcess(CHAT_APP_EXE)
    if (appSessions.size === 0) return false
    if (!process.argv.includes('--service')) return true
    const explorerSessions = await getSessionIdsForProcess('explorer.exe')
    for (const s of appSessions) {
      if (explorerSessions.has(s)) return true
    }
    return false
  } catch {
    return false
  }
}

async function launchInUserSession(exe, dataDir) {
  const escExe = exe.replace(/'/g, "''")
  const escDir = dataDir.replace(/'/g, "''")
  const psLines = [
    "$explorer = Get-CimInstance Win32_Process -Filter \"Name = 'explorer.exe'\" -EA SilentlyContinue | Select -First 1",
    'if (-not $explorer) { exit 1 }',
    '$owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner',
    '$userId = \"$($owner.Domain)\\$($owner.User)\"',
    `$action = New-ScheduledTaskAction -Execute '${escExe}' -Argument '\"${escDir}\" --tray'`,
    '$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    "Register-ScheduledTask -TaskName 'KCChatTrayStart' -Action $action -Principal $principal -Settings $settings -Force | Out-Null",
    "Start-ScheduledTask -TaskName 'KCChatTrayStart'",
    'Start-Sleep -Seconds 2',
    "Unregister-ScheduledTask -TaskName 'KCChatTrayStart' -Confirm:$false -EA SilentlyContinue"
  ]
  await runEncodedPS(psLines.join('\n'), 25000)
}

export async function startChatWidgetIfNeeded() {
  if (await isChatAppRunningInUserSession()) return true

  const now = Date.now()
  if (isLaunching || now - lastLaunchAttempt < 15000) return false
  isLaunching = true
  lastLaunchAttempt = now

  try {
    const exe = getChatAppPath()
    if (!fs.existsSync(exe)) {
      log('ChatTrayApp.exe not found: ' + exe)
      return false
    }

    if (process.argv.includes('--service')) {
      await launchInUserSession(exe, CHAT_DATA_DIR)
    } else {
      const child = spawn(exe, [CHAT_DATA_DIR, '--tray'], { detached: true, stdio: 'ignore' })
      child.unref()
    }

    await delay(1500)
    const ok = await isChatAppRunningInUserSession()
    if (ok) log('ChatTrayApp launched')
    return ok
  } catch (e) {
    log('launch error: ' + e.message)
    return false
  } finally {
    isLaunching = false
  }
}
