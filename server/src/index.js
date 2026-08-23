import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { config } from './config.js'
import { ping, pool } from './db.js'
import { errorHandler } from './errors.js'
import { runMaintenance } from './maintenance.js'
import { runMigrations } from './migrate.js'
import agentRoutes from './routes/agent.js'
import authRoutes from './routes/auth.js'
import deviceRoutes from './routes/devices.js'

const app = Fastify({
  logger: {
    level: config.env === 'production' ? 'info' : 'debug',
    // The panel sends an Authorization header on every request; the default
    // serializer would put it in the log, where the backup then carries it
    // off-site. Log the shape of a request, not its credentials.
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, ip: req.ip })
    }
  },
  // Trust X-Forwarded-For only from Nginx Proxy Manager's network, not from
  // anyone. `true` would take the header from any caller — and the API also
  // sits on proxy-network alongside other projects' containers, so a
  // neighbour could forge an address and walk straight past the rate limit
  // on the login route.
  trustProxy: config.trustedProxies,
  bodyLimit: 2 * 1024 * 1024
})

const startedAt = Date.now()

// Read from package.json rather than npm_package_version: the container starts
// with `node src/index.js`, not through npm, so that variable is never set and
// /health would report a hardcoded version forever.
const { version } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
)

// ok=false means the service cannot do its job. A slow query or a single failed
// request is not that; an unreachable database is. Nginx Proxy Manager and the
// existing monitoring both read this.
app.get('/health', async (_req, reply) => {
  let dbOk = false
  let dbError = null
  try {
    dbOk = await ping()
  } catch (err) {
    dbError = err.message
  }

  const body = {
    ok: dbOk,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    db: dbOk ? 'up' : 'down',
    version
  }
  if (dbError) body.error = dbError

  return reply.code(dbOk ? 200 : 503).send(body)
})

app.setErrorHandler(errorHandler)

let pruneTimer = null

async function registerPlugins() {
  // The panel lives on kidscontrol.kz and the API on api.kidscontrol.kz, so
  // every panel request is cross-origin. Tokens travel in the Authorization
  // header rather than cookies, so credentials are not needed — and without
  // them a wildcard would still not expose anything a token does not.
  const allowedOrigins = new Set([
    config.publicOrigin,
    config.publicOrigin.replace('https://', 'https://www.')
  ])
  if (config.env !== 'production') {
    allowedOrigins.add('http://localhost:5173')
  }

  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header: the agent, curl, health checks. Not a browser, so
      // there is no same-origin policy to enforce here.
      if (!origin) return cb(null, true)
      cb(null, allowedOrigins.has(origin))
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    maxAge: 86400
  })

  // A blanket ceiling so one misbehaving agent cannot saturate the box; login
  // and registration have their own tighter limits in the routes themselves.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // request.ip is the forwarded client address, but only when the header
    // came from a trusted proxy — see trustProxy above.
    keyGenerator: (request) => request.ip
    // The 429 body is shaped in errorHandler, not here: the plugin raises an
    // error that the error handler catches, so anything built at this point
    // gets overwritten anyway.
  })

  await app.register(authRoutes, { prefix: '/api/v1' })
  await app.register(deviceRoutes, { prefix: '/api/v1' })
  await app.register(agentRoutes, { prefix: '/api/v1' })
}

async function start() {
  // Compose already waits for the database healthcheck, but a Postgres restart
  // (backup, host reboot) can still leave us starting first. Retry instead of
  // dying: a crash loop here reads like a broken deploy when it is not.
  for (let attempt = 1; ; attempt++) {
    try {
      await runMigrations()
      break
    } catch (err) {
      if (attempt >= 10) {
        app.log.error(`migrations failed after ${attempt} attempts: ${err.message}`)
        process.exit(1)
      }
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 30_000)
      app.log.warn(`migrations failed (${err.message}), retrying in ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
    }
  }

  await registerPlugins()

  await app.listen({ port: config.port, host: config.host })
  app.log.info(`kidscontrol api listening on ${config.host}:${config.port}`)

  // Spent sessions and pairing codes accumulate forever otherwise. Runs once
  // at startup so a box that reboots daily still gets cleaned; unref() so a
  // pending timer never holds up shutdown.
  runMaintenance(app.log)
  pruneTimer = setInterval(() => runMaintenance(app.log), 6 * 60 * 60 * 1000)
  pruneTimer.unref()
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`)
    try {
      if (pruneTimer) clearInterval(pruneTimer)
      await app.close()
      await pool.end()
    } finally {
      process.exit(0)
    }
  })
}

start().catch((err) => {
  app.log.error(err)
  process.exit(1)
})
