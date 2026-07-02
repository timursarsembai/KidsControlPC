import * as Sentry from '@sentry/node'
import { APP_ENV, SENTRY_DSN, AGENT_VERSION } from '../config.js'

export function initErrorTracking() {
  if (!SENTRY_DSN) return
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: APP_ENV,
    release: `kidscontrol-agent@${AGENT_VERSION}`,
    tracesSampleRate: 0, // errors only, no performance tracing
  })
}

export function captureError(err, context = {}) {
  if (!SENTRY_DSN) return
  Sentry.captureException(err, { extra: context })
}

export function setAgentContext(parentUid, deviceId) {
  if (!SENTRY_DSN) return
  Sentry.setUser({ id: deviceId })
  Sentry.setTag('parentUid', parentUid)
}
