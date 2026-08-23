import Fastify from 'fastify'
import { config } from './config.js'
import { ping, pool } from './db.js'
import { runMigrations } from './migrate.js'

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
  trustProxy: true,       // behind Nginx Proxy Manager
  bodyLimit: 2 * 1024 * 1024
})

const startedAt = Date.now()

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
    version: process.env.npm_package_version || '0.1.0'
  }
  if (dbError) body.error = dbError

  return reply.code(dbOk ? 200 : 503).send(body)
})

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

  await app.listen({ port: config.port, host: config.host })
  app.log.info(`kidscontrol api listening on ${config.host}:${config.port}`)
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`)
    try {
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
