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

  // Куда складываются скриншоты. Отдельный том, а не каталог образа: образ
  // пересобирается при каждом выкате.
  storageRoot: process.env.STORAGE_ROOT || '/var/lib/kidscontrol/files',

  // Whose X-Forwarded-For header is believed: the proxy-network subnet, where
  // Nginx Proxy Manager lives, and nothing else. Loopback is deliberately not
  // here — local probes send no forwarding header, so they lose nothing, and
  // anything that does reach 127.0.0.1:8092 directly should not get to pick
  // its own client address.
  trustedProxies: (process.env.TRUSTED_PROXIES || '172.18.0.0/16')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Mail is optional until kidscontrol.kz is delegated and a mailbox exists.
  // Without SMTP_HOST the service runs exactly as before and simply cannot
  // send — the routes that would email say so in the log.
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.MAIL_FROM || null,
    // Accept a self-signed certificate from the mail server.
    //
    // Only ever true for a relay inside this machine's docker network — the
    // local sender uses a self-signed certificate, and the connection never
    // leaves the host. For an outside provider this stays off: there the
    // certificate is the only thing proving you are talking to them and not
    // to whoever intercepted the connection.
    allowSelfSigned: process.env.SMTP_ALLOW_SELF_SIGNED === 'true'
  },

  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 30 * 24 * 60 * 60,
  agentTokenTtlSec: 60 * 60,
  pairingCodeTtlSec: 15 * 60,

  // Long enough to find the letter in a spam folder, short enough that a link
  // left in an inbox stops being a key by morning.
  passwordResetTtlSec: 60 * 60,
  emailVerificationTtlSec: 24 * 60 * 60
}
