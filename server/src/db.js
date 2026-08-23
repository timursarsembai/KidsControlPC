import pg from 'pg'

// Every timestamp column in the schema is timestamptz, which node-postgres
// already parses into a correct instant. If a plain `timestamp` column ever
// appears, it will need an explicit parser here — it would otherwise be read
// in the container's local zone.

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
})

// A dead pool client must not take the process down with it. Postgres restarts
// (and the nightly backup) close connections; the pool replaces them by itself.
pool.on('error', (err) => {
  console.error(`[db] idle client error: ${err.message}`)
})

export function query(text, params) {
  return pool.query(text, params)
}

export async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    try { await client.query('rollback') } catch { /* connection already gone */ }
    throw err
  } finally {
    client.release()
  }
}

// Used by /health and by the startup wait loop.
export async function ping() {
  const { rows } = await pool.query('select 1 as ok')
  return rows[0]?.ok === 1
}
