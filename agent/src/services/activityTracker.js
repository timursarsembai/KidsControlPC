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
import { getInstalledBasenames, getInstalledPathPrefixes, getInstalledNameMap } from './programInventory.js'

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
  'conhost', 'dwm', 'fontdrvhost', 'registry', 'idle', 'system',
  // Windows search
  'searchindexer', 'searchprotocolhost', 'searchfilterhost',
  // Windows security / smartscreen / defender
  'smartscreen', 'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray',
  'mpsigstub', 'mpdefendercorespsa',
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
  // Windows update / telemetry / licensing
  'tiworker', 'wuauclt', 'musnotification', 'musnotificationux',
  'compattelrunner', 'wsqmcons', 'sppsvc', 'sppextcomobj', 'trustedinstaller',
  // Location / notifications / sync services
  'locationnotificationwindows', 'mobsync', 'wscsvc',
  // Chrome elevation service
  'elevation_service',
  // Xbox Game Bar (launches automatically with games)
  'gamebar', 'gamebarftserver', 'gamebarft', 'gameinputsvc',
  // Our own agent
  'updater', 'node',
])

// Pattern-based filter for processes whose names include a version number or
// match known updater/installer naming conventions (e.g. microsoftedge_x64_149.8,
// am_delta_patch_1.453.29, onedrivestandaloneupdat).
function isSystemByPattern(name) {
  if (!name) return false
  // Starts with known prefixes
  if (name.startsWith('kca_setup')) return true
  if (name.startsWith('microsoftedge_')) return true
  if (name.startsWith('am_delta_patch')) return true
  if (name.startsWith('onedrive') && (name.includes('updat') || name.includes('setup'))) return true
  // Generic: name contains digits after underscore (version pattern like foo_1.2.3)
  if (/^[a-z_]+_\d/.test(name)) return true
  // Ends in common service/stub/helper suffixes without being a known user app
  if (/(?:svc|stub|helper|host|service|broker|daemon|agent|updater|installer|setup)$/.test(name) &&
      !['explorer', 'taskmgr'].includes(name)) return true
  return false
}

function friendlyName(base, procName) {
  const map = getInstalledNameMap()
  return (map && map.get(base)) || procName || base
}

// ── App tracking ──────────────────────────────────────────────────────────────

// { baseName: startedAtMs }  — set when process first appears
const launchTimes = {}

// { baseName: displayName }  — friendly name at launch time
const launchNames = {}

// Set of basenames seen in the previous enforcer tick
let prevProcessBases = null

// Minimum time a process must run before we log it (avoid flash processes)
const MIN_DURATION_MS = 5_000  // 5 sec

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

  // Filter pipeline — removes system/background processes, keeps user-facing apps
  const whitelist = getInstalledBasenames()  // null until first program scan completes
  const userProcs = processes.filter(p => {
    // Layer 1: SessionId > 0 filtered in PowerShell, but double-check here
    if ((p.sessionId || 0) === 0) return false
    // Layer 2: require visible window handle — tray apps and background services
    // have MainWindowHandle=0; games (Roblox) have a handle even without a title
    if (!p.hasWindow) return false
    // Layer 3: explicit blocklist
    if (SYSTEM_BLOCKLIST.has(p.base) || SYSTEM_BLOCKLIST.has(p.name)) return false
    // Layer 4: whitelist bypass — installed apps skip pattern filter entirely,
    // so apps with "host/service/agent" in their name (e.g. BattleHost) are not blocked
    if (whitelist !== null && whitelist.has(p.base)) return true
    // Layer 5: pattern filter — only for processes not in whitelist
    if (isSystemByPattern(p.base) || isSystemByPattern(p.name)) return false
    // Layer 5b: path prefix fallback + Windows built-ins
    if (whitelist !== null) {
      const isWindowsBuiltin = p.path && p.path.startsWith('c:\\windows\\') && p.windowTitle
      if (!isWindowsBuiltin) {
        const prefixes = getInstalledPathPrefixes()
        const procPath = (p.path || '').toLowerCase()
        if (!prefixes || !procPath || !prefixes.some(prefix => procPath.startsWith(prefix))) return false
      }
    }
    return true
  })
  const currentBases = new Set(userProcs.map(p => p.base).filter(Boolean))
  const now = Date.now()

  if (prevProcessBases === null) {
    // First tick — initialise without logging (avoid logging everything as "launched")
    prevProcessBases = currentBases
    for (const base of currentBases) {
      launchTimes[base] = now
      const p = userProcs.find(x => x.base === base)
      launchNames[base] = friendlyName(base, p?.name)
    }
    return
  }

  // Detect newly launched processes
  for (const base of currentBases) {
    if (!prevProcessBases.has(base)) {
      launchTimes[base] = now
      const proc = userProcs.find(p => p.base === base)
      launchNames[base] = friendlyName(base, proc?.name)
      try {
        await addDoc(activityLogsRef(parentUid, deviceId), {
          type: 'app_launch',
          ts: serverTimestamp(),
          name: launchNames[base],
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

      if ((now - startedAt) < MIN_DURATION_MS) {
        delete launchTimes[base]
        delete launchNames[base]
        continue  // too short — skip
      }

      const durationSec = Math.round((now - startedAt) / 1000)
      const displayName = launchNames[base] || base
      delete launchTimes[base]
      delete launchNames[base]

      try {
        await addDoc(activityLogsRef(parentUid, deviceId), {
          type: 'app_close',
          ts: serverTimestamp(),
          name: displayName,
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
