const MAX_LOGS = 500
const logs = []
const listeners = new Set()

function addLog(level, category, args) {
  const message = args.map(a => {
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')

  const entry = {
    ts: Date.now(),
    level,
    category: category || 'general',
    msg: message.slice(0, 1000)
  }

  logs.push(entry)
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS)
  }

  listeners.forEach(fn => fn(entry))
}

export const logger = {
  info: (category, ...args) => {
    console.log(`[${category}]`, ...args)
    addLog('info', category, args)
  },
  warn: (category, ...args) => {
    console.warn(`[${category}]`, ...args)
    addLog('warn', category, args)
  },
  error: (category, ...args) => {
    console.error(`[${category}]`, ...args)
    addLog('error', category, args)
  },

  getLogs: (category) => {
    if (!category) return [...logs]
    return logs.filter(l => l.category === category)
  },

  subscribe: (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
}
