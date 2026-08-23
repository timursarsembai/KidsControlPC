// Talks to the self-hosted backend. Exposes the same surface firebaseSync.js
// does, so agent.js and the services do not care which one is in use.
//
// Everything here obeys the rules the Firebase version was beaten into:
//
//  * no fetch, no undici — plain https (see httpClient.js);
//  * losing the network never ends the process;
//  * rules are handed to configManager, which caches them to disk, so
//    enforcement survives a reboot with no connection at all.

import { hostname } from 'os'
import { existsSync, readFileSync } from 'fs'
import { AGENT_VERSION, PAIRING_FILE } from '../config.js'
import { eventBus, EVENTS } from '../core/eventBus.js'
import { setActiveRules, setDeviceConfig, setParentConfig } from '../core/configManager.js'
import { getRecentLogs } from '../core/logBuffer.js'
import { api, clearAccessToken, getAccessToken, HttpError, isTokenExpired, setAccessToken } from './httpClient.js'
import { createLiveChannel } from './wsClient.js'

let parentUid = null
let deviceId = null
let live = null
let authInFlight = null

// Commands already handed to the handlers. The live channel re-sends its
// snapshot on every reconnect, and without this a lock command would be
// executed again on each wake-up.
const dispatchedCommands = new Set()

function log(msg) {
  console.log(`[SelfHostedSync] ${msg}`)
}

function readDeviceSecret() {
  if (!existsSync(PAIRING_FILE)) return null
  try {
    const pairing = JSON.parse(readFileSync(PAIRING_FILE, 'utf8'))
    // deviceSecret is the self-hosted name; screenshotUploadToken is what a
    // pairing file written by the Firebase build calls the same thing.
    return pairing.deviceSecret || pairing.screenshotUploadToken || null
  } catch (err) {
    log(`Could not read ${PAIRING_FILE}: ${err.message}`)
    return null
  }
}

/**
 * Exchanges the stored device secret for an access token.
 *
 * One exchange at a time: a heartbeat and a rule fetch discovering an expired
 * token together would otherwise both authenticate, and the second would be
 * doing it for nothing.
 */
export async function ensureAgentAuth() {
  if (!isTokenExpired()) return true
  if (authInFlight) return authInFlight

  authInFlight = (async () => {
    const deviceSecret = readDeviceSecret()
    if (!deviceSecret || !deviceId) {
      log('No device secret on disk — this device needs to be paired again')
      return false
    }
    try {
      const result = await api.post('/agent/token', { deviceId, deviceSecret }, { auth: false })
      setAccessToken(result.accessToken, result.expiresIn)
      log('Device token obtained')
      return true
    } catch (err) {
      // A refused secret is permanent until someone re-pairs; a network error
      // is not. Neither is a reason to stop running: enforcement continues
      // from the cached rules either way.
      if (err instanceof HttpError && err.status === 401) {
        clearAccessToken()
        log('Device secret refused — re-pair this device')
      } else {
        log(`Token request failed: ${err.message}`)
      }
      return false
    } finally {
      authInFlight = null
    }
  })()
  return authInFlight
}

// Applies a channel snapshot or patch. Rules go through configManager, which
// writes them to disk — that cache is what keeps a child's PC enforcing while
// offline.
function applyRules(rules) {
  setActiveRules(rules)
}

function applyDevice(device) {
  if (!device) return
  setDeviceConfig(device)
}

function dispatchCommand(command) {
  if (!command?.id || dispatchedCommands.has(command.id)) return
  dispatchedCommands.add(command.id)
  // Bounded: a device that has run for months would otherwise accumulate one
  // entry per command it ever saw.
  if (dispatchedCommands.size > 500) {
    for (const id of dispatchedCommands) {
      dispatchedCommands.delete(id)
      if (dispatchedCommands.size <= 250) break
    }
  }
  eventBus.emit(EVENTS.COMMAND_RECEIVED, { doc: { id: command.id }, cmd: command })
}

let pullTimer = null
function schedulePull() {
  if (pullTimer) return
  pullTimer = setTimeout(() => {
    pullTimer = null
    pullEverything().catch(err => log(`refresh after change failed: ${err.message}`))
  }, 500)
  pullTimer.unref?.()
}

// Used both by the live channel's fallback and at startup: one fetch of
// everything the agent needs to act correctly.
async function pullEverything() {
  if (!await ensureAgentAuth()) return

  const [rules, commands, device] = await Promise.all([
    api.get('/agent/rules'),
    api.get('/agent/commands'),
    api.get('/agent/device')
  ])

  applyRules(rules.rules ?? [])
  for (const command of commands.commands ?? []) dispatchCommand(command)

  // /agent/device, not /agent/me: the config has to arrive whole. A partial
  // answer would overwrite the cached one with less than it had, and the first
  // thing to go missing would be isLocked — a locked screen unlocking itself.
  if (device?.device) {
    applyDevice(device.device)
    // Account-wide emergency unlock. The enforcer reads it from parentConfig,
    // the same place the Firebase build put it.
    setParentConfig({ pauseAllRules: Boolean(device.pauseAllRules) })
  }
}

// Exposed for the integration probe: exercises the polling path directly,
// which is what runs whenever the live channel is unavailable.
export const __pullForTest = () => pullEverything()

export async function initSync(pUid, dId) {
  parentUid = pUid
  deviceId = dId

  await ensureAgentAuth()

  live = createLiveChannel({
    getToken: getAccessToken,
    log: (msg) => log(msg),
    poll: pullEverything,
    onSnapshot: (channel, data) => {
      if (channel === 'rules') {
        log(`Received ${data.length} rules`)
        applyRules(data)
      } else if (channel === 'device') {
        applyDevice(data[0])
      } else if (channel === 'commands') {
        for (const command of data) dispatchCommand(command)
      }
    },
    onPatch: (channel, op, data) => {
      if (channel === 'commands' && op === 'upsert') {
        dispatchCommand(data)
        return
      }
      // Rules and device config are small; refetching the channel state costs
      // less than maintaining a second copy of the merge logic here, and it
      // cannot drift from what the server actually has.
      //
      // Debounced: a parent editing a schedule produces a burst of changes,
      // and one refetch per change would be a burst of requests from a home
      // connection for a state that settles in a second anyway.
      schedulePull()
    }
  })
  live.start()

  // The socket may take a while to come up, and the agent should not wait to
  // find out what it must enforce.
  await pullEverything().catch(err => log(`initial pull failed: ${err.message}`))

}

export function stopSync() {
  live?.stop()
  live = null
}

export async function sendHeartbeat() {
  if (!deviceId) return
  if (!await ensureAgentAuth()) return

  try {
    await api.post('/agent/heartbeat', { agentVersion: AGENT_VERSION, status: 'online' })
    // A token can be revoked while a socket stays open; the heartbeat is the
    // first thing to notice, so let the channel re-authenticate with it.
    if (live && !live.connected) live.reconnectNow()
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      // Either the token expired or the parent cut this device off. Ask for a
      // new one; if the secret is gone too, the next attempt says so.
      clearAccessToken()
      log('Heartbeat rejected — re-authenticating')
      return
    }
    // Used to be process.exit(1) after three of these. On Windows 11 with
    // Modern Standby that turned every resume into a restart, and if the
    // network was still down at the next start, enforcement might never be
    // scheduled at all.
    log(`Heartbeat failed: ${err.message}`)
  }
}

const lastAlerts = {}

export async function sendAlert(type, details = '') {
  if (!deviceId) return

  const key = `${type}|${details}`
  const now = Date.now()
  if (lastAlerts[key] && now - lastAlerts[key] < 60_000) return
  lastAlerts[key] = now
  for (const k of Object.keys(lastAlerts)) {
    if (now - lastAlerts[k] > 60_000) delete lastAlerts[k]
  }

  if (!await ensureAgentAuth()) return
  try {
    await api.post('/agent/alerts', { type, details, deviceHostname: hostname() })
    log(`Alert sent: ${type}`)
  } catch (err) {
    log(`Failed to send alert: ${err.message}`)
  }
}

export async function markCommandCompleted(cmdDoc, extra = {}) {
  await reportCommand(cmdDoc, 'completed', extra.error)
}

export async function markCommandFailed(cmdDoc, errorMsg) {
  await reportCommand(cmdDoc, 'failed', errorMsg)
}

async function reportCommand(cmdDoc, status, error) {
  const id = cmdDoc?.id ?? cmdDoc?.ref?.id
  if (!id) return
  if (!await ensureAgentAuth()) return
  try {
    await api.patch(`/agent/commands/${id}`, {
      status,
      ...(error ? { error: String(error).slice(0, 1000) } : {})
    })
  } catch (err) {
    log(`Could not report command ${id}: ${err.message}`)
  }
}

export async function markDeviceOffline() {
  if (!deviceId || !getAccessToken()) return
  try {
    await api.post('/agent/heartbeat', { status: 'offline' })
  } catch {
    // Shutting down anyway; the server marks the device offline by itself once
    // the heartbeats stop.
  }
}

export async function publishPomodoroState(state) {
  if (!deviceId) return
  if (!await ensureAgentAuth()) return

  const pomodoroState = state
    ? {
        active: true,
        phase: state.phase,
        isWorkPhase: state.isWorkPhase,
        phaseEndsAtMs: state.phaseEndsAtMs,
        startedAtMs: state.startedAtMs,
        workDuration: state.workDuration,
        breakDuration: state.breakDuration,
        longBreakDuration: state.longBreakDuration,
        cyclesToLongBreak: state.cyclesToLongBreak,
        updatedAt: new Date().toISOString()
      }
    : { active: false, updatedAt: new Date().toISOString() }

  try {
    await api.post('/agent/pomodoro', { state: pomodoroState })
  } catch (err) {
    log(`Could not publish pomodoro state: ${err.message}`)
  }
}

export async function pushRecentLogs() {
  if (!deviceId) return
  if (!await ensureAgentAuth()) return
  try {
    await api.post('/agent/logs', { lines: getRecentLogs().slice(-100) })
  } catch (err) {
    log(`Failed to push logs: ${err.message}`)
  }
}

/**
 * Activity: screen time and DNS lookups.
 *
 * Counters are deltas — the agent reports what happened during this tick and
 * the server adds them up. It has no idea what the running total is, and
 * asking would be a request per tick for a number nobody on this machine
 * needs.
 */
// Activity is buffered rather than sent event by event. The tracker produces
// a handful of entries every few seconds, and on a home connection one request
// per entry is both slow and a good way to lose them all when the link blips.
const activityBuffer = { logs: [], stats: {} }
let activityFlushTimer = null

/** Queues one event. Sent with the next flush. */
export function queueActivityLog(kind, payload) {
  activityBuffer.logs.push({ kind, ts: new Date().toISOString(), payload })
  // Bounded: an agent offline for a day would otherwise grow this until the
  // machine complained. The oldest go first — recent activity is what the
  // parent looks at.
  if (activityBuffer.logs.length > 500) {
    activityBuffer.logs.splice(0, activityBuffer.logs.length - 500)
  }
  scheduleActivityFlush()
}

/**
 * Adds to a daily counter.
 *
 * Keys are flat, with dots for nesting — 'appsUsage.chrome' rather than a
 * nested object. Firestore's increment() worked on nested paths; here the
 * server adds up whatever keys it is given, and the read side puts the nesting
 * back so the panel sees the shape it always saw.
 */
export function bumpActivityStat(date, key, delta) {
  if (!date || !key || !delta) return
  const day = activityBuffer.stats[date] ?? (activityBuffer.stats[date] = {})
  day[key] = (day[key] ?? 0) + delta
  scheduleActivityFlush()
}

function scheduleActivityFlush() {
  if (activityFlushTimer) return
  activityFlushTimer = setTimeout(() => {
    activityFlushTimer = null
    flushActivity().catch(err => log(`activity flush failed: ${err.message}`))
  }, 15_000)
  activityFlushTimer.unref?.()
}

export async function flushActivity() {
  if (activityBuffer.logs.length === 0 && Object.keys(activityBuffer.stats).length === 0) return

  // Taken out of the buffer before the request so events recorded while it is
  // in flight are not lost — and put back if the send fails, so a blip does
  // not silently drop a child's afternoon.
  const logs = activityBuffer.logs.splice(0, activityBuffer.logs.length)
  const stats = activityBuffer.stats
  activityBuffer.stats = {}

  try {
    await sendActivity({ logs, stats })
  } catch (err) {
    activityBuffer.logs.unshift(...logs.slice(-500))
    for (const [date, counters] of Object.entries(stats)) {
      const day = activityBuffer.stats[date] ?? (activityBuffer.stats[date] = {})
      for (const [key, value] of Object.entries(counters)) {
        day[key] = (day[key] ?? 0) + value
      }
    }
    throw err
  }
}

export async function sendActivity({ logs = [], stats = {} } = {}) {
  if (!deviceId) return
  if (logs.length === 0 && Object.keys(stats).length === 0) return
  if (!await ensureAgentAuth()) return

  try {
    await api.post('/agent/activity', { logs, stats })
  } catch (err) {
    log(`Could not send activity: ${err.message}`)
  }
}

export async function uploadInstalledApps(apps) {
  if (!deviceId || !apps?.length) return
  if (!await ensureAgentAuth()) return

  // Chunked: a Windows machine reports a few hundred programs, and one request
  // carrying all of them over a home connection is a request that times out
  // half-way and stores nothing.
  for (let i = 0; i < apps.length; i += 200) {
    try {
      await api.post('/agent/apps', { apps: apps.slice(i, i + 200) })
    } catch (err) {
      log(`Could not upload programs (chunk ${i}): ${err.message}`)
      return
    }
  }
}

/**
 * Reports what the enforcer knows about a rule: that it has fired and is now
 * inactive, or that the program it covers is running right now.
 *
 * A failure here is not worth retrying — the next enforcement tick, five
 * seconds away, reports the current state anyway.
 */
export async function updateRule(ruleId, patch) {
  if (!ruleId || !patch || Object.keys(patch).length === 0) return
  if (!await ensureAgentAuth()) return
  try {
    await api.patch(`/agent/rules/${ruleId}`, patch)
  } catch (err) {
    log(`Could not update rule ${ruleId}: ${err.message}`)
  }
}

export function updateRuleStatus(ruleId, status) {
  return updateRule(ruleId, { status })
}

export function getParentUid() {
  return parentUid
}
