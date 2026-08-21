import fs from 'fs'
import os from 'os'
// These paths always describe the agent's Windows install/output dirs, even
// when this module is loaded on a non-Windows host (e.g. running tests) —
// use path.win32 so separators stay deterministic regardless of host OS.
import path from 'path/win32'
import { randomUUID } from 'crypto'
import { execAsync, runEncodedPS } from '../core/utils.js'

const DEFAULT_QUALITY = 70
const DEFAULT_MAX_WIDTH = 1280
const CAPTURE_TIMEOUT_MS = 30000
const OUTPUT_DIR_NAME = 'KidsControlPC\\Screenshots'

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

export function getScreenshotOutputDir() {
  const baseDir = process.env.ProgramData || os.tmpdir()
  return path.join(baseDir, OUTPUT_DIR_NAME)
}

function getErrorPath(outputPath) {
  return `${outputPath}.error.txt`
}

function readHelperError(outputPath) {
  try {
    const errorPath = getErrorPath(outputPath)
    if (!fs.existsSync(errorPath)) return ''
    return fs.readFileSync(errorPath, 'utf8').trim()
  } catch {
    return ''
  }
}

export function buildScreenshotFailureMessage(outputPath, fallback = 'Screenshot helper did not produce output') {
  const helperError = readHelperError(outputPath)
  return helperError ? `${fallback}: ${helperError}` : fallback
}

async function waitForScreenshotOutput(outputPath, timeoutMs = CAPTURE_TIMEOUT_MS) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(outputPath)) return
    if (fs.existsSync(getErrorPath(outputPath))) {
      throw new Error(buildScreenshotFailureMessage(outputPath))
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(buildScreenshotFailureMessage(outputPath))
}

async function prepareOutputDir(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true })
  if (process.platform !== 'win32') return

  try {
    await execAsync(`icacls "${outputDir}" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C`, {
      timeout: 10000,
      windowsHide: true
    })
  } catch {
    // Best effort: capture may still work if inherited ACLs already allow it.
  }
}

async function launchHelperInUserSession(helperPath, outputPath, maxWidth, quality) {
  if (!fs.existsSync(helperPath)) {
    throw new Error(`ScreenshotHelper not found: ${helperPath}`)
  }

  if (!process.argv.includes('--service')) {
    const helperProcess = execAsync(`"${helperPath}" "${outputPath}" ${maxWidth} ${quality}`, {
      timeout: 30000,
      windowsHide: true
    })
    try {
      await waitForScreenshotOutput(outputPath)
    } catch (err) {
      const helperError = await helperProcess.catch(processErr => processErr)
      if (helperError instanceof Error && !readHelperError(outputPath)) {
        throw helperError
      }
      throw err
    }
    await helperProcess.catch(() => {})
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
  try {
    await runEncodedPS(psLines.join('\n'), 45000)
  } catch (err) {
    throw new Error(buildScreenshotFailureMessage(outputPath, err.message), { cause: err })
  }
}

export async function captureScreenshotFile(settings) {
  const requestId = randomUUID()
  const outputDir = getScreenshotOutputDir()
  await prepareOutputDir(outputDir)
  const outputPath = path.join(outputDir, `${requestId}.jpg`)
  const helperPath = getScreenshotHelperPath()
  const maxWidth = normalizeNumber(settings.maxWidth, DEFAULT_MAX_WIDTH, 320, 3840)
  const quality = normalizeNumber(settings.quality, DEFAULT_QUALITY, 20, 95)

  await launchHelperInUserSession(helperPath, outputPath, maxWidth, quality)
  await waitForScreenshotOutput(outputPath)
  const stats = fs.statSync(outputPath)
  if (stats.size <= 0) throw new Error('Screenshot file is empty')

  return { requestId, outputPath, maxWidth, quality, size: stats.size }
}
