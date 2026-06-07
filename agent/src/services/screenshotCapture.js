import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { execAsync, runEncodedPS } from '../core/utils.js'

const DEFAULT_QUALITY = 70
const DEFAULT_MAX_WIDTH = 1280

function getScreenshotHelperPath() {
  return process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'dist', 'ScreenshotHelper.exe')
    : path.join(process.cwd(), 'ScreenshotHelper.exe')
}

export function normalizeNumber(value, fallback, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

async function launchHelperInUserSession(helperPath, outputPath, maxWidth, quality) {
  if (!fs.existsSync(helperPath)) {
    throw new Error(`ScreenshotHelper not found: ${helperPath}`)
  }

  if (!process.argv.includes('--service')) {
    await execAsync(`"${helperPath}" "${outputPath}" ${maxWidth} ${quality}`, {
      timeout: 30000,
      windowsHide: true
    })
    return
  }

  const taskName = `KCScreenshot_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  const escapedHelper = helperPath.replace(/'/g, "''")
  const escapedOutput = outputPath.replace(/'/g, "''")
  const psLines = [
    "$explorer = Get-CimInstance Win32_Process -Filter \"Name = 'explorer.exe'\" -EA SilentlyContinue | Select -First 1",
    'if (-not $explorer) { throw "No active explorer.exe session found" }',
    '$owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner',
    '$userId = "$($owner.Domain)\\$($owner.User)"',
    `$action = New-ScheduledTaskAction -Execute '${escapedHelper}' -Argument '"${escapedOutput}" ${maxWidth} ${quality}'`,
    '$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 45)',
    `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${taskName}'`,
    '$deadline = (Get-Date).AddSeconds(30)',
    `while ((Get-Date) -lt $deadline -and -not (Test-Path '${escapedOutput}')) { Start-Sleep -Milliseconds 500 }`,
    `Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -EA SilentlyContinue`,
    `if (-not (Test-Path '${escapedOutput}')) { throw "Screenshot helper did not produce output" }`
  ]
  await runEncodedPS(psLines.join('\n'), 45000)
}

export async function captureScreenshotFile(settings) {
  const requestId = randomUUID()
  const outputDir = path.join(os.tmpdir(), 'kidscontrol-screenshots')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${requestId}.jpg`)
  const helperPath = getScreenshotHelperPath()
  const maxWidth = normalizeNumber(settings.maxWidth, DEFAULT_MAX_WIDTH, 320, 3840)
  const quality = normalizeNumber(settings.quality, DEFAULT_QUALITY, 20, 95)

  await launchHelperInUserSession(helperPath, outputPath, maxWidth, quality)
  const stats = fs.statSync(outputPath)
  if (stats.size <= 0) throw new Error('Screenshot file is empty')

  return { requestId, outputPath, maxWidth, quality, size: stats.size }
}
