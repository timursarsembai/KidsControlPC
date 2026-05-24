/**
 * Windows System Scanner — v3
 * Fixes: UTF-8 encoding, robust process matching, garbled name filtering
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

// ─── Run PowerShell via temp .ps1 file ───────────────────────────────────────
async function runPS(script, timeoutMs = 30000) {
  const tmpFile = join(tmpdir(), `kc_${Date.now()}.ps1`)
  try {
    // UTF-8 BOM so PowerShell reads the file correctly
    const bom = Buffer.from([0xEF, 0xBB, 0xBF])
    writeFileSync(tmpFile, Buffer.concat([bom, Buffer.from(script, 'utf8')]))

    // -OutputEncoding and chcp 65001 ensure UTF-8 output back to Node.js
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
  // Count replacement/private-use chars and control chars
  const bad = (str.match(/[\uFFFD\uE000-\uF8FF\u0000-\u001F\u25C6]/g) || []).length
  return bad > 2
}

// ─── Get installed programs ───────────────────────────────────────────────────
export async function getInstalledPrograms() {
  const script = `
# Force UTF-8 output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = @()
foreach ($p in $paths) {
  $items = Get-ItemProperty $p -ErrorAction SilentlyContinue
  if ($items) { $apps += $items }
}
$result = $apps |
  Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' -and -not $_.SystemComponent -and -not $_.ReleaseType } |
  Select-Object DisplayName, InstallLocation, DisplayIcon, Publisher, DisplayVersion |
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
      .filter(app => !isGarbled(app.DisplayName))   // ← skip garbled entries
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

        // Extract exe filename for name-based matching
        const exeBasename = execPath && execPath.toLowerCase().endsWith('.exe')
          ? basename(execPath, '.exe').toLowerCase()
          : ''

        const id = Buffer.from(app.DisplayName).toString('base64').slice(0, 20)
        return {
          id,
          name: app.DisplayName.trim(),
          path: execPath,
          exeBasename,
          publisher: app.Publisher?.trim() || '',
          version: app.DisplayVersion?.trim() || '',
          running: false,
          blocked: false,
          source: 'registry'
        }
      })
  } catch (err) {
    console.error('[Scanner] getInstalledPrograms error:', err.message)
    throw err
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
  Select-Object Name, Id, Path, CPU |
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
        name: p.Name.toLowerCase(),                    // e.g. "zoom"
        pid:  p.Id,
        path: (p.Path || '').toLowerCase(),            // e.g. "c:\...\zoom.exe"
        base: p.Path ? basename(p.Path, extname(p.Path)).toLowerCase() : p.Name.toLowerCase()
      }))
  } catch (err) {
    console.error('[Scanner] getRunningProcesses error:', err.message)
    return []
  }
}

// ─── Merge: programs + running status ────────────────────────────────────────
export async function getSystemApps() {
  const [programs, processes] = await Promise.all([
    getInstalledPrograms(),
    getRunningProcesses().catch(() => [])
  ])

  // Build lookup sets for fast matching
  const runningByPath = new Set(processes.map(p => p.path).filter(Boolean))
  const runningByBase = new Set(processes.map(p => p.base).filter(Boolean))
  const runningByName = new Set(processes.map(p => p.name).filter(Boolean))

  return programs.map(app => {
    const pathLow = app.path?.toLowerCase() || ''
    const baseLow = app.exeBasename || ''
    const nameLow = app.name.toLowerCase().replace(/\s+/g, '')

    const running =
      (pathLow && runningByPath.has(pathLow)) ||
      (baseLow && runningByBase.has(baseLow)) ||
      runningByName.has(nameLow)

    return { ...app, running }
  })
}
