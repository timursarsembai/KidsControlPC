// Ring buffer for agent logs that will be synced to Firebase
const MAX_LOG_ENTRIES = 200
const logBuffer = []

// Store original console methods
const originalLog = console.log
const originalWarn = console.warn
const originalError = console.error

function addEntry(level, args) {
  const message = args.map(a => {
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
  
  logBuffer.push({
    ts: Date.now(),
    level,
    msg: message.slice(0, 500) // Limit message length
  })
  
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES)
  }
}

export function initLogCapture() {
  console.log = (...args) => {
    addEntry('info', args)
    originalLog.apply(console, args)
  }
  console.warn = (...args) => {
    addEntry('warn', args)
    originalWarn.apply(console, args)
  }
  console.error = (...args) => {
    addEntry('error', args)
    originalError.apply(console, args)
  }
}

export function getRecentLogs() {
  return [...logBuffer]
}

export function getLogsSince(sinceTs) {
  return logBuffer.filter(entry => entry.ts > sinceTs)
}
