// Plain SQL migrations, applied in filename order inside one transaction each.
//
// No migration library on purpose: the whole mechanism is thirty lines, and one
// fewer dependency is one fewer thing that can break the build of a service
// whose job is to keep working unattended.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// Same number in every process: whoever gets the lock migrates, the others wait
// and then find nothing to do. Matters as soon as the API runs more than once.
const LOCK_ID = 0x6b6964_73  // 'kids'

export async function runMigrations() {
  const client = await pool.connect()
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `)
    await client.query('select pg_advisory_lock($1)', [LOCK_ID])

    const { rows } = await client.query('select name from schema_migrations')
    const applied = new Set(rows.map(r => r.name))

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      console.log(`[migrate] applying ${file}`)
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
        count++
      } catch (err) {
        await client.query('rollback')
        throw new Error(`migration ${file} failed: ${err.message}`)
      }
    }

    console.log(count > 0 ? `[migrate] applied ${count} migration(s)` : '[migrate] up to date')
    return count
  } finally {
    try { await client.query('select pg_advisory_unlock($1)', [LOCK_ID]) } catch { /* lock dies with the session */ }
    client.release()
  }
}

// `npm run migrate` — run migrations and exit, without starting the server.
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[migrate] ${err.message}`)
      process.exit(1)
    })
}
