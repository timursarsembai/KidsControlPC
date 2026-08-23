// Fail loudly at startup rather than at the first request. A container that
// restarts in a loop with a clear reason in the log is easier to diagnose than
// one that runs and rejects every login with a 500.

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET']

const missing = REQUIRED.filter(k => !process.env[k])
if (missing.length > 0) {
  console.error(`[config] missing required environment: ${missing.join(', ')}`)
  process.exit(1)
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[config] JWT_SECRET is too short — expected at least 32 characters')
  process.exit(1)
}

export const config = {
  port: Number(process.env.PORT) || 8092,
  host: '0.0.0.0',
  env: process.env.NODE_ENV || 'production',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  publicOrigin: process.env.PUBLIC_ORIGIN || 'https://kidscontrol.kz',

  // Whose X-Forwarded-For header is believed: the proxy-network subnet, where
  // Nginx Proxy Manager lives, and nothing else. Loopback is deliberately not
  // here — local probes send no forwarding header, so they lose nothing, and
  // anything that does reach 127.0.0.1:8092 directly should not get to pick
  // its own client address.
  trustedProxies: (process.env.TRUSTED_PROXIES || '172.18.0.0/16')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 30 * 24 * 60 * 60,
  agentTokenTtlSec: 60 * 60,
  pairingCodeTtlSec: 15 * 60
}
