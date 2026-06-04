const PROTECTED_PROCESS_BASES = new Set([
  'agent',
  'kidscontrolagent',
  'kidscontrolpcagent',
  'timerwidget',
  'reminderwidget',
  'screenblockerwidget',
  'customdialogwidget',
  'sessionlauncher',
  'winsw'
])

const PROTECTED_NAME_PARTS = [
  'kidscontrol agent',
  'kidscontrolpc agent',
  'kidscontrolpc child agent',
  'kidscontrol pc agent'
]

const PROTECTED_PATH_PARTS = [
  '\\kidscontrolagent',
  '\\kidscontrolpc agent'
]

function normalize(value) {
  return String(value || '').toLowerCase()
}

function normalizePath(value) {
  const normalized = normalize(value).replace(/\//g, '\\')
  return normalized ? `\\${normalized.replace(/^\\+/, '')}` : ''
}

export function isProtectedProcess(proc = {}) {
  if (proc.pid && proc.pid === process.pid) return true

  const name = normalize(proc.name)
  const base = normalize(proc.base)
  const path = normalizePath(proc.path)

  if (PROTECTED_PROCESS_BASES.has(name) || PROTECTED_PROCESS_BASES.has(base)) return true
  if (PROTECTED_PATH_PARTS.some(part => path.includes(part))) return true

  return false
}

export function isProtectedProgramEntry(entry = {}) {
  const name = normalize(entry.name || entry.DisplayName)
  const path = normalizePath(entry.path || entry.InstallLocation || entry.DisplayIcon)
  const uninstallCmd = normalizePath(entry.uninstallCmd || entry.UninstallString || entry.QuietUninstallString)

  if (PROTECTED_NAME_PARTS.some(part => name.includes(part))) return true
  if (PROTECTED_PATH_PARTS.some(part => path.includes(part) || uninstallCmd.includes(part))) return true

  return false
}
