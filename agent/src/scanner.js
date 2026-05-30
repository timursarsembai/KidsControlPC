/**
 * Windows System Scanner for Child Agent
 * Reads installed apps from HKLM/HKCU Registry and finds running processes
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

// ─── Run PowerShell via temp .ps1 file ───────────────────────────────────────
async function runPS(script, timeoutMs = 30000) {
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
    return stdout.trim()
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

try {
  $appx = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.InstallLocation } | Select-Object @{Name="DisplayName";Expression={$_.Name}}, InstallLocation, @{Name="DisplayIcon";Expression={""}}, @{Name="Publisher";Expression={$_.Publisher}}, @{Name="DisplayVersion";Expression={$_.Version}}, @{Name="QuietUninstallString";Expression={"powershell.exe -WindowStyle Hidden -Command \`"Remove-AppxPackage -Package $($_.PackageFullName)\`""}}, @{Name="UninstallString";Expression={""}}, @{Name="SystemComponent";Expression={0}}, @{Name="ParentKeyName";Expression={$null}}
  if ($appx) { $apps += $appx }
} catch {}

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

        const id = Buffer.from(app.DisplayName).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
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
    console.error('[Scanner] getInstalledPrograms error:', err.message)
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
  Where-Object { $_.Name -notin $skip } |
  Select-Object Name, Id, Path |
  Sort-Object Name -Unique

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
        base: p.Path ? basename(p.Path, extname(p.Path)).toLowerCase() : p.Name.toLowerCase()
      }))
  } catch (err) {
    console.error('[Scanner] getRunningProcesses error:', err.message)
    return []
  }
}
