/**
 * Process enforcer
 * Monitors running processes and terminates blocked programs
 */

import { exec } from 'child_process'
import { promisify } from 'util'
// Rule/process paths are always Windows paths regardless of host OS — see scanner.js.
import { basename } from 'path/win32'
import { isProtectedProcess } from './selfProtection.js'

const execAsync = promisify(exec)

// ─── Kill a process by PID ────────────────────────────────────────────────────
async function killPid(pid, name) {
  try {
    await execAsync(`taskkill /F /PID ${pid}`, { timeout: 5000 })
    console.log(`[Enforcer] Killed process: ${name} (PID ${pid})`)
    return true
  } catch (err) {
    console.warn(`[Enforcer] Failed to kill ${name} (PID ${pid}):`, err.message)
    return false
  }
}

// ─── Check if a rule matches a running process ────────────────────────────────
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/[^a-z0-9а-яё]+/gi, '')
}

function isRobloxPlayerRule(rulePathLow, ruleNameLow) {
  const normalizedName = normalizeText(ruleNameLow)
  return (
    normalizedName.includes('robloxplayer') ||
    normalizedName.includes('roblox') ||
    rulePathLow.includes('\\roblox\\versions\\')
  ) && !normalizedName.includes('studio')
}

function isRobloxPlayerProcess(proc) {
  const haystack = `${proc.name || ''} ${proc.base || ''} ${proc.path || ''}`.toLowerCase()
  return haystack.includes('roblox') && haystack.includes('player') && !haystack.includes('studio')
}

function isMinecraftLauncherRule(rulePathLow, ruleNameLow) {
  const normalizedName = normalizeText(ruleNameLow)
  return (
    normalizedName.includes('minecraftwindowsbeta') ||
    normalizedName.includes('minecraftlauncher') ||
    rulePathLow.includes('minecraftwindowsbeta')
  )
}

function isMinecraftGameProcess(proc) {
  const name = (proc.name || '').toLowerCase()
  const base = (proc.base || '').toLowerCase()
  const path = (proc.path || '').toLowerCase()
  return (
    name === 'minecraft.windows' ||
    base === 'minecraft.windows' ||
    path.includes('minecraftuwp') ||
    path.includes('minecraft - bedrock')
  )
}

function directoryRuleMatchesProcess(rulePathLow, procPath) {
  if (!rulePathLow || !procPath || rulePathLow.endsWith('.exe')) return false
  if (procPath.startsWith(rulePathLow + '\\')) return true

  if (rulePathLow.includes('\\roblox\\versions\\')) {
    const lastSlash = rulePathLow.lastIndexOf('\\')
    const versionsDir = lastSlash >= 0 ? rulePathLow.slice(0, lastSlash) : rulePathLow
    return procPath.startsWith(versionsDir + '\\')
  }

  return false
}

function ruleMatchesProcess(rule, proc) {
  const procPath = proc.path || ''
  const procName = proc.name || ''
  const procBase = proc.base || ''

  const rulePathLow = (rule.program?.executablePath || '').toLowerCase()
  const ruleNameLow = (rule.program?.name || '').toLowerCase()
  const ruleBaseLow = rulePathLow
    ? basename(rulePathLow, '.exe').toLowerCase()
    : ruleNameLow.replace(/\s+/g, '')

  // Match by exe path (most precise)
  if (rulePathLow && procPath) {
    if (rulePathLow === procPath) return true
    if (directoryRuleMatchesProcess(rulePathLow, procPath)) return true
  }

  if (isRobloxPlayerRule(rulePathLow, ruleNameLow) && isRobloxPlayerProcess(proc)) return true
  if (isMinecraftLauncherRule(rulePathLow, ruleNameLow) && isMinecraftGameProcess(proc)) return true

  // Match by exe basename
  if (ruleBaseLow && procBase && ruleBaseLow === procBase) return true
  // Match by name similarity
  if (ruleNameLow && procName && (
    procName.includes(ruleBaseLow) || ruleBaseLow.includes(procName)
  )) return true

  return false
}

// ─── Main enforcement function ────────────────────────────────────────────────
/**
 * @param {Array} activeBlockedRules - Rules from Firestore where type='program' and status='active'
 * @param {Array} processes - Pre-scanned running processes from scanner.js
 * @returns {Array<{name: string, interactive: boolean}>}
 */
export async function enforceProcessRules(activeBlockedRules, processes) {
  if (!activeBlockedRules || activeBlockedRules.length === 0) return []
  if (!processes || processes.length === 0) return []

  let killedEvents = []
  for (const proc of processes) {
    if (isProtectedProcess(proc)) continue

    for (const rule of activeBlockedRules) {
      if (ruleMatchesProcess(rule, proc)) {
        const ok = await killPid(proc.pid, proc.name)
        if (ok) {
          killedEvents.push({
            name: rule.program?.name || proc.name,
            interactive: Boolean(proc.hasWindow)
          })
        }
        break  // Don't check more rules for this process
      }
    }
  }

  return killedEvents
}
