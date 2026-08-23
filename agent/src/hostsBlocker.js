/**
 * Hosts-file blocker
 * Rewrites the KidsControlPC section of C:\Windows\System32\drivers\etc\hosts
 * Requires the agent to be running with Administrator privileges
 */

import { readFileSync, writeFileSync } from 'fs'
import { HOSTS_FILE, HOSTS_BLOCK_START, HOSTS_BLOCK_END } from './config.js'

const PROTECTED_DOMAINS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'kidscontrolpc.firebaseapp.com',
  'kidscontrolpc.firebasestorage.app'
])

function normalizeDomain(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
}

export function isProtectedDomain(domain) {
  return PROTECTED_DOMAINS.has(normalizeDomain(domain))
}

// ─── Read current hosts ───────────────────────────────────────────────────────
function readHosts() {
  try {
    return readFileSync(HOSTS_FILE, 'utf8')
  } catch {
    return ''
  }
}

// ─── Remove our block section ─────────────────────────────────────────────────
function stripOurSection(content) {
  const startIdx = content.indexOf(HOSTS_BLOCK_START)
  const endIdx   = content.indexOf(HOSTS_BLOCK_END)
  if (startIdx === -1 || endIdx === -1) return content.trimEnd()
  return (content.slice(0, startIdx) + content.slice(endIdx + HOSTS_BLOCK_END.length)).trimEnd()
}

// ─── Build block entries for a list of domains ────────────────────────────────
function buildBlockSection(domains) {
  if (!domains || domains.length === 0) return ''
  const safeDomains = domains
    .map(normalizeDomain)
    .filter(domain => domain && !isProtectedDomain(domain))

  const lines = [...new Set(safeDomains)].flatMap(domain => [
    `0.0.0.0 ${domain}`,
    `0.0.0.0 www.${domain}`,
  ])

  if (lines.length === 0) return ''

  return [
    '',
    HOSTS_BLOCK_START,
    `# Updated: ${new Date().toISOString()}`,
    ...lines,
    HOSTS_BLOCK_END,
    ''
  ].join('\n')
}

// ─── Apply blocked domains list ───────────────────────────────────────────────
// Called from the enforcement tick, i.e. every 5 seconds. It used to rewrite the hosts
// file unconditionally on each pass — pointless disk churn on a file Windows and
// antivirus software both watch closely, and the source of the recurring
// "EBUSY: resource busy or locked" errors, plus one log line every 5 seconds.
export function applyHostsBlock(domains) {
  const current  = readHosts()
  const stripped = stripOurSection(current)
  const section  = buildBlockSection(domains)
  const next     = stripped + section

  if (next === current) return true

  try {
    writeFileSync(HOSTS_FILE, next, 'utf8')
    console.log(`[Hosts] Applied ${domains.length} blocked domain(s)`)
    return true
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error('[Hosts] Permission denied — agent must run as Administrator')
    } else {
      console.error('[Hosts] Write error:', err.message)
    }
    return false
  }
}

// ─── Remove all our blocks ────────────────────────────────────────────────────
export function clearHostsBlock() {
  const current  = readHosts()
  const stripped = stripOurSection(current)
  try {
    writeFileSync(HOSTS_FILE, stripped, 'utf8')
    console.log('[Hosts] Cleared all blocks')
  } catch (err) {
    console.error('[Hosts] Clear error:', err.message)
  }
}

// ─── Extract domains from a rule ─────────────────────────────────────────────
export function extractDomains(webRule) {
  const { inputUrl, scope, resolvedPattern } = webRule
  if (!inputUrl) return []

  try {
    const raw = inputUrl.includes('://') ? inputUrl : `https://${inputUrl}`
    const url = new URL(raw)
    const hostname = url.hostname.replace(/^www\./, '')

    switch (scope) {
      case 'domain': return [hostname]
      case 'path':   return [hostname]   // path-level: still block domain in hosts
      case 'exact':  return [hostname]   // exact: block whole domain (hosts limitation)
      default:       return [hostname]
    }
  } catch {
    // If URL parsing fails, use raw input
    return [inputUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]]
  }
}
