/**
 * Process enforcer
 * Monitors running processes and terminates blocked programs
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { basename } from 'path'

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
    // UWP / Appx apps have folders as InstallLocation
    if (procPath.startsWith(rulePathLow + '\\')) return true
  }
  
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
