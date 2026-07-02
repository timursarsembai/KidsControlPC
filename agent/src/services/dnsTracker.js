import { addDoc, collection, doc, setDoc, increment, serverTimestamp } from 'firebase/firestore'
import { db } from '../network/firebaseSync.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

function log(msg) { console.log(`[DnsTracker] ${msg}`) }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Domains logged this session: domain → lastLoggedAtMs
// Reset every hour to allow re-logging revisited sites
const loggedDomains = new Map()
const LOG_COOLDOWN_MS = 60 * 60 * 1000  // 1 hour

// Last set of normalized non-system domains seen in DNS cache (used by enforcer
// to detect which blocked domains were actually visited)
let _lastCacheDomains = new Set()
export function getLastCacheDomains() { return _lastCacheDomains }

// System/CDN domain suffixes to skip
const SYSTEM_SUFFIXES = [
  'microsoft.com', 'windows.com', 'windowsupdate.com', 'msn.com',
  'bing.com', 'live.com', 'azure.com', 'azure.net', 'trafficmanager.net',
  'akamai.net', 'akamaiedge.net', 'akamaized.net', 'akadns.net',
  'cloudfront.net', 'amazonaws.com', 'awsglobalaccelerator.com',
  'googleapis.com', 'gstatic.com', 'google-analytics.com', 'doubleclick.net',
  'googlevideo.com', 'ytimg.com', 'ggpht.com',
  'facebook.net', 'fbcdn.net', 'fbsbx.com',
  'apple.com', 'icloud.com', 'mzstatic.com',
  'digicert.com', 'ocsp.sectigo.com', 'ocsp.pki.goog', 'crl.microsoft.com',
  'kaspersky.com', 'kaspersky.ru', 'avast.com', 'avg.com',
  'office.com', 'office365.com', 'microsoftonline.com', 'sharepoint.com',
  'skype.com', 'teams.microsoft.com',
  'yandex.net', 'yastatic.net', 'yandexmetrica.com',
  'cdn77.org', 'fastly.net', 'edgecastcdn.net', 'limelight.com',
]

// Exact domains to always skip
const SYSTEM_EXACT = new Set([
  'localhost', 'wpad', 'isatap',
])

function normalizeDomain(entry) {
  if (!entry) return null
  let d = entry.trim().toLowerCase()
  // Strip trailing dot
  if (d.endsWith('.')) d = d.slice(0, -1)
  // Skip IP addresses
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.includes(':')) return null
  // Skip local/internal
  if (d.endsWith('.local') || d.endsWith('.internal') || d.endsWith('.lan')) return null
  // Must have at least one dot
  if (!d.includes('.')) return null
  // Strip www.
  if (d.startsWith('www.')) d = d.slice(4)
  return d || null
}

function isSystemDomain(domain) {
  if (SYSTEM_EXACT.has(domain)) return true
  // Skip single-label after www strip
  if (!domain.includes('.')) return true
  for (const suffix of SYSTEM_SUFFIXES) {
    if (domain === suffix || domain.endsWith('.' + suffix)) return true
  }
  return false
}

async function runPS(script, timeoutMs = 15000) {
  const tmpFile = join(tmpdir(), `kca_dns_${Date.now()}.ps1`)
  try {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF])
    writeFileSync(tmpFile, Buffer.concat([bom, Buffer.from(script, 'utf8')]))
    const cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8' })
    return stdout.trim()
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch {}
  }
}

async function getDnsCacheDomains() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$entries = Get-DnsClientCache | Select-Object -ExpandProperty Entry -Unique
if ($entries) { $entries | ConvertTo-Json -Compress } else { Write-Output '[]' }
`
  try {
    const raw = await runPS(script)
    if (!raw || raw === 'null' || raw === '[]') return []
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.filter(Boolean)
  } catch (e) {
    log(`DNS query error: ${e.message}`)
    return []
  }
}

export async function tickDnsTracking(parentUid, deviceId) {
  if (!parentUid || !deviceId) return

  const rawDomains = await getDnsCacheDomains()
  if (!rawDomains.length) return

  const now = Date.now()
  const newDomains = []
  const cacheDomains = new Set()

  for (const entry of rawDomains) {
    const domain = normalizeDomain(String(entry))
    if (!domain) continue
    if (isSystemDomain(domain)) continue
    cacheDomains.add(domain)
    const lastLogged = loggedDomains.get(domain)
    if (lastLogged && (now - lastLogged) < LOG_COOLDOWN_MS) continue
    loggedDomains.set(domain, now)
    newDomains.push(domain)
  }

  _lastCacheDomains = cacheDomains

  // Prune stale entries to prevent unbounded Map growth
  const pruneThreshold = now - LOG_COOLDOWN_MS
  for (const [domain, lastSeen] of loggedDomains) {
    if (lastSeen < pruneThreshold) loggedDomains.delete(domain)
  }

  if (!newDomains.length) return

  const logsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'activityLogs')
  const statsRef = doc(db, 'users', parentUid, 'devices', deviceId, 'activityStats', todayStr())
  const sitesVisitedIncrement = {}

  for (const domain of newDomains) {
    sitesVisitedIncrement[domain] = increment(1)
    try {
      await addDoc(logsRef, {
        type: 'site_visit',
        ts: serverTimestamp(),
        name: domain,
        detail: '',
      })
    } catch (e) {
      log(`site_visit write error: ${e.message}`)
    }
  }

  try {
    await setDoc(statsRef, {
      date: todayStr(),
      sitesVisited: sitesVisitedIncrement,
    }, { merge: true })
  } catch (e) {
    log(`sitesVisited stats error: ${e.message}`)
  }

  log(`Logged ${newDomains.length} new domains: ${newDomains.slice(0, 5).join(', ')}`)
}

export { normalizeDomain, isSystemDomain } // @internal — for testing only
