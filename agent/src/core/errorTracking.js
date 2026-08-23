import * as Sentry from '@sentry/node'
import { APP_ENV, SENTRY_DSN, AGENT_VERSION } from '../config.js'

// Error tracking must never be able to take down the process it is monitoring.
// pkg embeds Node.js 18.5.0 and @sentry/node 10.x requires >= 18.19, so Sentry.init()
// throws "TypeError: undefined is not a function" inside the packaged agent. Because
// initErrorTracking() runs at module scope in agent.js — before main(), before the
// pairing prompt — that killed the agent instantly on every start from v1.1.103 on,
// which looked like "the installer finishes but never asks for a pairing code".
let enabled = false

export function initErrorTracking() {
  if (!SENTRY_DSN) return
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
