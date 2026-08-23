import * as Sentry from '@sentry/node'
import { APP_ENV, SENTRY_DSN, AGENT_VERSION } from '../config.js'

// Error tracking must never be able to take down the process it is monitoring.
// pkg embeds Node.js 18.5.0 and @sentry/node 10.x requires >= 18.19, so Sentry.init()
// throws "TypeError: undefined is not a function" inside the packaged agent. Because
// initErrorTracking() runs at module scope in agent.js — before main(), before the
// pairing prompt — that killed the agent instantly on every start from v1.1.103 on,
// which looked like "the installer finishes but never asks for a pairing code".
let enabled = false

// @sentry/node 10.x needs Node >= 18.19 (or >= 20.6). pkg tops out at Node 18.5, so
// in the packaged agent init() always throws. Skip it outright rather than calling it
// and swallowing the failure — that kept dumping a stack trace to stderr on every
// start. The guard stays version-based so this revives itself if the agent ever moves
// off pkg to a newer runtime.
function runtimeSupportsSentry() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major > 20) return true
  if (major === 20) return minor >= 6
  if (major === 18) return minor >= 19
  return false
}

export function initErrorTracking() {
  if (!SENTRY_DSN) return
  if (!runtimeSupportsSentry()) {
    console.log(`[ErrorTracking] Disabled — Node ${process.versions.node} is too old for @sentry/node`)
    return
  }
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: APP_ENV,
      release: `kidscontrol-agent@${AGENT_VERSION}`,
      tracesSampleRate: 0, // errors only, no performance tracing
    })
    enabled = true
  } catch (err) {
    console.log(`[ErrorTracking] Disabled — Sentry init failed: ${err.message}`)
  }
}

export function captureError(err, context = {}) {
  if (!enabled) return
  try {
    Sentry.captureException(err, { extra: context })
  } catch { /* never let reporting an error raise another one */ }
}

export function setAgentContext(parentUid, deviceId) {
  if (!enabled) return
  try {
    Sentry.setUser({ id: deviceId })
    Sentry.setTag('parentUid', parentUid)
  } catch { /* non-fatal */ }
}
