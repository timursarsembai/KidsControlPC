/**
 * Windows System Scanner for Child Agent
 * Reads installed apps from HKLM/HKCU Registry and finds running processes
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
// Process/registry paths always come from Windows (PowerShell output) regardless
// of what OS this code happens to run on (e.g. tests on a Linux dev machine) —
// parse them with path.win32, not the host-native path module.
import { basename, extname } from 'path/win32'
import { tmpdir, freemem, totalmem } from 'os'
import { createHash } from 'crypto'
import { isProtectedProgramEntry, isProtectedProcess } from './selfProtection.js'

const execAsync = promisify(exec)

// Scans run on the 5-second enforcement tick, each spawning a powershell.exe. On a
// machine that has run out of memory that spawn is exactly what fails first, and
// retrying it every 5 seconds piles more pressure onto an already struggling system.
// Observed on a child PC with ~6% free RAM: PowerShell failing while Edge, Roblox and a
// torrent client held ~2.5 GB between them.
//
// Back off instead. Callers already treat a failure as "no data" and carry on, so the
// only behavioural change is that we stop hammering — enforcement keeps running from the
// cached rules throughout.
const PS_BACKOFF_BASE_MS = 15_000
const PS_BACKOFF_MAX_MS = 5 * 60_000
let psFailures = 0
let psCooldownUntil = 0

function reportSystemPressure() {
  const freeMb = Math.round(freemem() / 1048576)
  const totalMb = Math.round(totalmem() / 1048576)
  return `${freeMb}MB free of ${totalMb}MB`
}

async function runPS(script, timeoutMs = 30000) {
  if (Date.now() < psCooldownUntil) {
    const err = new Error('PowerShell scanning is backing off after repeated failures')
    err.code = 'ps_cooldown'
    throw err
  }

  const tmpFile = join(tmpdir(), `kca_scan_${Date.now()}.ps1`)
  try {
    // UTF-8 BOM so PowerShell reads the file correctly
    const bom = Buffer.from([0xEF, 0xBB, 0xBF])
    writeFileSync(tmpFile, Buffer.concat([bom, Buffer.from(script, 'utf8')]))

    const cmd = [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', `"${tmpFile}"`
    ].join(' ')

    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8'
    })

    if (stderr && stderr.trim()) {
      console.warn('[Scanner] PS stderr:', stderr.slice(0, 300))
    }
    if (psFailures > 0) {
      console.log(`[Scanner] PowerShell recovered after ${psFailures} failure(s) — ${reportSystemPressure()}`)
      psFailures = 0
      psCooldownUntil = 0
    }
    return stdout.trim()
  } catch (err) {
    psFailures++
    const cooldown = Math.min(PS_BACKOFF_BASE_MS * 2 ** (psFailures - 1), PS_BACKOFF_MAX_MS)
    psCooldownUntil = Date.now() + cooldown
    console.error(
      `[Scanner] PowerShell failed (${psFailures}), pausing scans for ${Math.round(cooldown / 1000)}s ` +
      `— ${reportSystemPressure()} — ${err.message}`
    )
    throw err
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch {}
  }
}

// ─── Detect garbled / non-printable names ────────────────────────────────────
function isGarbled(str) {
  if (!str) return true
  const bad = (str.match(/[\uFFFD\uE000-\uF8FF\u0000-\u001F\u25C6]/g) || []).length
  return bad > 2
}

// ─── Get installed programs ───────────────────────────────────────────────────
export async function getInstalledPrograms() {
  const script = `
# Force UTF-8 output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS -ErrorAction SilentlyContinue | Out-Null


$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKU:\\*\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKU:\\*\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = @()
foreach ($p in $paths) {
  $items = Get-ItemProperty $p -ErrorAction SilentlyContinue
  if ($items) { $apps += $items }
}

$appx = Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue
if ($appx) {
    foreach ($pkg in $appx) {
        if ($pkg.IsFramework -eq $false -and $pkg.NonRemovable -eq $false) {
            $uwp = [PSCustomObject]@{
                DisplayName = $pkg.Name
                InstallLocation = $pkg.InstallLocation
                DisplayIcon = ""
                Publisher = $pkg.Publisher
                DisplayVersion = $pkg.Version
                QuietUninstallString = ""
                UninstallString = ""
            }
            $apps += $uwp
        }
    }
}

# Scan Xbox Games library (Minecraft Launcher and Game Pass installs)
$xboxDirs = @("C:\XboxGames", "$env:LOCALAPPDATA\XboxGames")
foreach ($xboxDir in $xboxDirs) {
    if (Test-Path $xboxDir) {
        $gameFolders = Get-ChildItem -Path $xboxDir -Directory -ErrorAction SilentlyContinue
        foreach ($folder in $gameFolders) {
            $contentDir = Join-Path $folder.FullName "Content"
            $searchDir = if (Test-Path $contentDir) { $contentDir } else { $folder.FullName }
            $exe = Get-ChildItem -Path $searchDir -Filter "*.exe" -Depth 2 -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -notmatch 'unins|setup|install|update|crash|redist|vcredist' } |
                Sort-Object Length -Descending | Select-Object -First 1
            if ($exe) {
                $game = [PSCustomObject]@{
                    DisplayName = $folder.Name
                    InstallLocation = $exe.FullName
                    DisplayIcon = $exe.FullName
                    Publisher = ""
                    DisplayVersion = ""
                    QuietUninstallString = ""
                    UninstallString = ""
                }
                $apps += $game
            }
        }
    }
}

# Explicitly find Minecraft for Windows (installed via Minecraft Launcher)
$mcPkg = Get-AppxPackage -AllUsers -Name "Microsoft.MinecraftUWP" -ErrorAction SilentlyContinue
if ($mcPkg) {
    $mcExe = Join-Path $mcPkg.InstallLocation "Minecraft.Windows.exe"
    $mc = [PSCustomObject]@{
        DisplayName = "Minecraft for Windows"
        InstallLocation = if (Test-Path $mcExe) { $mcExe } else { $mcPkg.InstallLocation }
        DisplayIcon = if (Test-Path $mcExe) { $mcExe } else { "" }
        Publisher = $mcPkg.Publisher
        DisplayVersion = $mcPkg.Version
        QuietUninstallString = ""
        UninstallString = ""
    }
    $apps += $mc
}

$result = $apps |
  Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName } |
  Select-Object DisplayName, InstallLocation, DisplayIcon, Publisher, DisplayVersion, QuietUninstallString, UninstallString |
  Sort-Object DisplayName -Unique

if ($result) {
  $result | ConvertTo-Json -Compress -Depth 2
} else {
  Write-Output '[]'
}
`
  try {
    const raw = await runPS(script, 25000)
    if (!raw || raw === '' || raw === 'null' || raw === '[]') return []

    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed]

    return list
      .filter(app => app && app.DisplayName && app.DisplayName.trim())
      .filter(app => !isGarbled(app.DisplayName))
      .filter(app => !isProtectedProgramEntry(app))
      .map(app => {
        let execPath = ''
        if (app.DisplayIcon) {
          execPath = app.DisplayIcon
            .replace(/,\s*-?\d+\s*$/, '') // remove ",0" or ",-1"
            .replace(/^["']|["']$/g, '')   // remove wrapping quotes
            .trim()
          if (!execPath.toLowerCase().endsWith('.exe')) execPath = ''
        }
        if (!execPath && app.InstallLocation) {
          execPath = app.InstallLocation.trim().replace(/^["']|["']$/g, '').replace(/\\$/, '')
        }

        const exeBasename = execPath && execPath.toLowerCase().endsWith('.exe')
          ? basename(execPath, '.exe').toLowerCase()
          : ''

        const id = createHash('sha1').update(app.DisplayName).digest('base64url').slice(0, 28)
        return {
          id,
          name: app.DisplayName.trim(),
          path: execPath,
          exeBasename,
          publisher: app.Publisher?.trim() || '',
          version: app.DisplayVersion?.trim() || '',
          uninstallCmd: app.QuietUninstallString?.trim() || app.UninstallString?.trim() || '',
          running: false
        }
      })
  } catch (err) {
    if (err.code !== 'ps_cooldown') console.error('[Scanner] getInstalledPrograms error:', err.message)
    return []
  }
}

// ─── Get running processes ────────────────────────────────────────────────────
export async function getRunningProcesses() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$skip = @('svchost','csrss','smss','wininit','winlogon','services','lsass','conhost','dwm','fontdrvhost','Registry','Idle','System','SearchIndexer','MsMpEng')
$procs = Get-Process |
  Where-Object { $_.Name -notin $skip -and $_.SessionId -gt 0 } |
  Select-Object Name, Id, Path, MainWindowHandle, SessionId, MainWindowTitle

if ($procs) {
  $procs | ConvertTo-Json -Compress -Depth 2
} else {
  Write-Output '[]'
}
`
  try {
    const raw = await runPS(script, 12000)
    if (!raw || raw === '' || raw === 'null' || raw === '[]') return []

    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed]

    return list
      .filter(p => p && p.Name)
      .map(p => ({
        name: p.Name.toLowerCase(),
        pid:  p.Id,
        path: (p.Path || '').toLowerCase(),
        base: p.Path ? basename(p.Path, extname(p.Path)).toLowerCase() : p.Name.toLowerCase(),
        hasWindow: Number(p.MainWindowHandle || 0) !== 0,
        sessionId: p.SessionId || 0,
        windowTitle: (p.MainWindowTitle || '').trim()
      }))
      .filter(p => !isProtectedProcess(p))
  } catch (err) {
    if (err.code !== 'ps_cooldown') console.error('[Scanner] getRunningProcesses error:', err.message)
    return []
  }
}
