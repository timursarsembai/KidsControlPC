/**
 * Activity tracker — records app launch/close events and screen time.
 *
 * App tracking: detects when a process appears/disappears between enforcer ticks
 * and writes app_launch / app_close events to activityLogs.
 *
 * Screen time: each heartbeat calls tickScreenTime() which increments
 * screenTimeSec for today and flushes to activityStats every FLUSH_INTERVAL_MS.
 */

import { addDoc, collection, doc, setDoc, increment, serverTimestamp } from 'firebase/firestore'
import { db } from '../network/firebaseSync.js'

function log(msg) {
  console.log(`[ActivityTracker] ${msg}`)
}

// ── System process blocklist ──────────────────────────────────────────────────
// Processes that are always Windows internals — never user-facing apps.
// Agent runs as SYSTEM service so MainWindowHandle is 0 for everything;
// we use a name-based filter instead.
const SYSTEM_BLOCKLIST = new Set([
  // Windows core
  'svchost', 'csrss', 'smss', 'wininit', 'winlogon', 'services', 'lsass',
  'conhost', 'dwm', 'fontdrvhost', 'registry', 'idle', 'system', 'wininit',
  // Windows search
  'searchindexer', 'searchprotocolhost', 'searchfilterhost',
  // Windows security / smartscreen
  'smartscreen', 'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray',
  // Windows runtime hosts
  'applicationframehost', 'backgroundtaskhost', 'runtimebroker',
  'shellexperiencehost', 'startmenuexperiencehost', 'textinputhost',
  'sihost', 'taskhostw', 'ctfmon', 'dllhost', 'wudfhost', 'wlanext',
  // AMD / NVIDIA drivers
  'atieclxx', 'atiesrxx', 'nvdisplay.container', 'nvcontainer',
  // Bluetooth / hardware OEM
  'btwrsupportservice', 'igfxem', 'igfxtray', 'hkcmd',
  // Windows aggregation / helpers
  'aggregatorhost', 'apphelpercap', 'filecoauth', 'microsoftedgeupdate',
  'usoclient', 'wermgr', 'mobsync', 'spoolsv', 'lsaiso', 'dashost',
  'audiodg', 'tabtip', 'tabtip32', 'regsvc', 'wmiprvse', 'msiexec',
  // Windows update / telemetry
  'tiworker', 'wuauclt', 'musnotification', 'musnotificationux',
  'compattelrunner', 'wsqmcons',
  // Our own agent / installer
  'kca_setup_v1.1.77', 'kca_setup_v1.1.78', 'updater', 'node',
])

// ── App tracking ──────────────────────────────────────────────────────────────

// { baseName: startedAtMs }  — set when process first appears
const launchTimes = {}

// Set of basenames seen in the previous enforcer tick
let prevProcessBases = null

// Minimum time a process must run before we log it (avoid flash processes)
const MIN_DURATION_MS = 5_000  // 5 sec

function todayStr() {
  return new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
}

function activityLogsRef(parentUid, deviceId) {
  return collection(db, 'users', parentUid, 'devices', deviceId, 'activityLogs')
}

function activityStatsRef(parentUid, deviceId, date) {
  return doc(db, 'users', parentUid, 'devices', deviceId, 'activityStats', date)
}

/**
 * Call after each getRunningProcesses() call in enforcer.js.
 * processes: array of { name, base, path } from scanner.js
 */
export async function trackAppDelta(processes, parentUid, deviceId) {
  if (!parentUid || !deviceId) return

  // Filter out known Windows system/background processes by name
  const userProcs = processes.filter(p =>
    !SYSTEM_BLOCKLIST.has(p.base) &&
    !SYSTEM_BLOCKLIST.has(p.name) &&
    !p.base.startsWith('kca_setup') &&
    !p.name.startsWith('kca_setup')
  )
  const currentBases = new Set(userProcs.map(p => p.base).filter(Boolean))
  const now = Date.now()

  if (prevProcessBases === null) {
    // First tick — initialise without logging (avoid logging everything as "launched")
    prevProcessBases = currentBases
    for (const base of currentBases) {
      launchTimes[base] = now
    }
    return
  }

  // Detect newly launched processes
  for (const base of currentBases) {
    if (!prevProcessBases.has(base)) {
      launchTimes[base] = now
      const proc = userProcs.find(p => p.base === base)
      try {
        await addDoc(activityLogsRef(parentUid, deviceId), {
          type: 'app_launch',
          ts: serverTimestamp(),
          name: proc?.name || base,
          detail: proc?.path || '',
        })
      } catch (e) {
        log(`app_launch write error: ${e.message}`)
      }
    }
  }

  // Detect closed processes
  for (const base of prevProcessBases) {
    if (!currentBases.has(base)) {
      const startedAt = launchTimes[base] || now
      const durationSec = Math.round((now - startedAt) / 1000)
      delete launchTimes[base]

      if ((now - startedAt) < MIN_DURATION_MS) continue  // too short — skip

      try {
        await addDoc(activityLogsRef(parentUid, deviceId), {
          type: 'app_close',
          ts: serverTimestamp(),
          name: base,
          detail: '',
          duration: durationSec,
        })
        // Roll up into daily stats
        await setDoc(activityStatsRef(parentUid, deviceId, todayStr()), {
          date: todayStr(),
          appsUsage: { [base]: increment(durationSec) },
        }, { merge: true })
      } catch (e) {
        log(`app_close write error: ${e.message}`)
      }
    }
  }

  prevProcessBases = currentBases
}

// ── Screen time ───────────────────────────────────────────────────────────────

// Accumulated seconds not yet flushed to Firestore
let pendingScreenSec = 0
const FLUSH_INTERVAL_MS = 5 * 60 * 1000   // flush every 5 minutes
let lastFlushAt = Date.now()

/**
 * Call on every heartbeat tick (every 30 sec).
 * Accumulates screen time locally and flushes to Firestore periodically.
 */
export async function tickScreenTime(parentUid, deviceId, intervalSec = 30) {
  if (!parentUid || !deviceId) return

  pendingScreenSec += intervalSec
  const now = Date.now()

  if (now - lastFlushAt >= FLUSH_INTERVAL_MS || pendingScreenSec >= 600) {
    const toFlush = pendingScreenSec
    pendingScreenSec = 0
    lastFlushAt = now

    try {
      await setDoc(activityStatsRef(parentUid, deviceId, todayStr()), {
        date: todayStr(),
        screenTimeSec: increment(toFlush),
      }, { merge: true })
    } catch (e) {
      // On failure, don't lose the seconds — add back
      pendingScreenSec += toFlush
      log(`screenTime flush error: ${e.message}`)
    }
  }
}

// ── Blocked sites ─────────────────────────────────────────────────────────────

// Domains logged in the current stats period — avoid re-logging on every enforcer tick
const loggedBlockedDomains = new Set()
let lastDomainReset = Date.now()
const DOMAIN_RESET_INTERVAL_MS = 60 * 60 * 1000  // reset per hour

/**
 * Call from hostsBlocker.js when a new list of domains is applied.
 * Logs only domains that are new since the last hour.
 */
export async function trackBlockedDomains(domains, parentUid, deviceId) {
  if (!parentUid || !deviceId || !domains.length) return

  const now = Date.now()
  if (now - lastDomainReset > DOMAIN_RESET_INTERVAL_MS) {
    loggedBlockedDomains.clear()
    lastDomainReset = now
  }

  const newDomains = domains.filter(d => !loggedBlockedDomains.has(d))
  if (!newDomains.length) return

  for (const domain of newDomains) {
    loggedBlockedDomains.add(domain)
    try {
      await addDoc(activityLogsRef(parentUid, deviceId), {
        type: 'site_blocked',
        ts: serverTimestamp(),
        name: domain,
        detail: '',
      })
      await setDoc(activityStatsRef(parentUid, deviceId, todayStr()), {
        date: todayStr(),
        sitesBlocked: { [domain]: increment(1) },
      }, { merge: true })
    } catch (e) {
      log(`site_blocked write error: ${e.message}`)
    }
  }
}
