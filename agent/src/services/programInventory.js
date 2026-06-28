import { collection, updateDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../network/firebaseSync.js'
import { getInstalledPrograms } from '../scanner.js'
import { delay } from '../core/utils.js'

export const PROGRAM_SCAN_INTERVAL_MS = 5 * 60 * 1000

let programScanInProgress = false
let lastUploadedAppsSignature = ''

// In-memory whitelist of exe basenames for activity filtering
let installedBasenames = null  // null = not yet scanned
export function getInstalledBasenames() { return installedBasenames }

// Directory path prefixes for apps where exeBasename couldn't be extracted
// (e.g. Roblox installs to a versioned subdir, DisplayIcon is a directory not an .exe)
let installedPathPrefixes = null  // null = not yet scanned
export function getInstalledPathPrefixes() { return installedPathPrefixes }

// Map of exeBasename → friendly display name  e.g. 'chrome' → 'Google Chrome'
let installedNameMap = null  // null = not yet scanned
export function getInstalledNameMap() { return installedNameMap }

export async function scanInstalledProgramsWithRetry(maxAttempts = 3, retryDelayMs = 30000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const apps = await getInstalledPrograms()
    if (apps.length > 0) return apps
    if (attempt < maxAttempts) await delay(retryDelayMs)
  }
  return []
}

export async function performProgramRescan(parentUid, deviceId, log, reason = 'manual') {
  if (!parentUid || !deviceId) return
  if (programScanInProgress) {
    log(`[Apps] Program scan already running, skipped (${reason})`)
    return
  }

  programScanInProgress = true
  try {
    log(`[Apps] Scanning installed programs (${reason})...`)
    const apps = await scanInstalledProgramsWithRetry()

    if (apps.length === 0) {
      log('[Apps] Scan returned 0 programs. Existing list preserved.')
      return
    }

    const appsSignature = apps
      .map(app => `${app.id}|${app.name}|${app.path}|${app.version}`)
      .sort()
      .join('\n')

    if (appsSignature === lastUploadedAppsSignature) {
      log(`[Apps] Program list unchanged (${apps.length} programs)`)
      return
    }

    const appsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'installedApps')
    for (let i = 0; i < apps.length; i += 400) {
      const batch = writeBatch(db)
      for (const app of apps.slice(i, i + 400)) {
        batch.set(doc(appsRef, app.id), {
          name: app.name,
          path: app.path,
          exeBasename: app.exeBasename || '',
          publisher: app.publisher || '',
          version: app.version || '',
          uninstallCmd: app.uninstallCmd || '',
          lastSeenScanAt: serverTimestamp()
        }, { merge: true })
      }
      await batch.commit()
    }

    await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), {
      installedApps: apps,
      installedAppsCount: apps.length,
      lastScanAt: new Date().toISOString()
    })

    lastUploadedAppsSignature = appsSignature
    installedBasenames = new Set(apps.map(a => a.exeBasename).filter(Boolean))
    installedNameMap = new Map(apps.filter(a => a.exeBasename).map(a => [a.exeBasename, a.name]))
    // For apps without a known exeBasename, store the install directory as path prefix
    installedPathPrefixes = apps
      .filter(a => !a.exeBasename && a.path)
      .map(a => {
        const p = a.path.toLowerCase().replace(/\\/g, '\\')
        // If path ends in .exe take its directory, otherwise use path as-is (directory)
        return p.endsWith('.exe') ? p.slice(0, p.lastIndexOf('\\')) : p.replace(/\\+$/, '')
      })
      .filter(Boolean)
    log(`[Apps] Uploaded ${apps.length} installed programs`)
  } catch (err) {
    log(`[Apps] Failed to upload programs: ${err.message}`)
  } finally {
    programScanInProgress = false
  }
}
