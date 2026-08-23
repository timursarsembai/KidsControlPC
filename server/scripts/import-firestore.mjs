// Loads an export produced by export-firestore.mjs into PostgreSQL.
//
// Idempotent: every row carries the Firestore id it came from (legacy_uid,
// legacy_id), and re-running updates instead of duplicating. That matters
// because the first run will be a rehearsal and the real one happens later,
// against data that has moved on.
//
//   docker compose exec api node scripts/import-firestore.mjs --file /tmp/export.ndjson
//   ... --dry-run    считает, но ничего не пишет
//
// Passwords are not imported. Firebase exports them as scrypt hashes with the
// project's own parameters, and reimplementing that for a one-off is
// cryptographic code written to be thrown away. Each account gets a temporary
// password printed here, which the owner passes on and the parent changes on
// first sign-in.

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { argv, exit } from 'node:process'
import { hashPassword } from '../src/auth/password.js'
import { pool, withTransaction } from '../src/db.js'

function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const filePath = arg('file')
const dryRun = argv.includes('--dry-run')

if (!filePath) {
  console.error('Usage: node scripts/import-firestore.mjs --file <export.ndjson> [--dry-run]')
  exit(1)
}

// Readable and unambiguous when spoken aloud or typed from a note: no l/1/I,
// no O/0. The parent changes it on first sign-in anyway, but they have to get
// through the door first.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
function temporaryPassword() {
  const bytes = randomBytes(12)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

function toTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// A Firestore rule document is a free-form object. Everything the relational
// schema owns is lifted out; the rest is stored as the payload, unchanged.
const RULE_OWN_FIELDS = new Set(['id', 'status', 'createdAt', 'updatedAt'])

function ruleParts(rule) {
  const payload = {}
  for (const [key, value] of Object.entries(rule)) {
    if (RULE_OWN_FIELDS.has(key)) continue
    payload[key] = value
  }
  return {
    // global_pomodoro and friends keep their fixed name; generated ids do not
    // become slugs, or two devices could never share one.
    slug: /^[a-z][a-z0-9_]{0,48}$/.test(rule.id) ? rule.id : null,
    status: rule.status === 'inactive' ? 'inactive' : 'active',
    payload
  }
}

// Firestore stored counters nested: { appsUsage: { chrome: 60 } }. The column
// holds them flat, and the read side puts the nesting back.
function flattenCounters(stat) {
  const flat = {}
  for (const [key, value] of Object.entries(stat)) {
    if (key === 'date' || key === 'id') continue
    if (typeof value === 'number') {
      flat[key] = value
    } else if (value && typeof value === 'object') {
      for (const [inner, count] of Object.entries(value)) {
        if (typeof count === 'number') flat[`${key}.${inner}`] = count
      }
    }
  }
  return flat
}

const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
const credentials = []
const totals = { accounts: 0, devices: 0, rules: 0, apps: 0, alerts: 0, logs: 0, stats: 0 }

for (const line of lines) {
  const record = JSON.parse(line)
  const password = temporaryPassword()

  if (dryRun) {
    totals.accounts++
    totals.devices += record.devices.length
    for (const device of record.devices) {
      totals.rules += device.rules.length
      totals.apps += device.apps.length
      totals.logs += device.activityLogs.length
      totals.stats += device.activityStats.length
    }
    totals.alerts += record.alerts.length
    continue
  }

  const passwordHash = await hashPassword(password)

  await withTransaction(async (client) => {
    // legacy_uid, not email: an account whose owner changed their address in
    // Firebase between the rehearsal and the real run is still the same
    // account, and matching on email would create a second one.
    const { rows: userRows } = await client.query(
      `insert into users (email, password_hash, email_verified, legacy_uid, created_at)
       values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
       on conflict (legacy_uid) do update
         set email = excluded.email,
             email_verified = excluded.email_verified,
             updated_at = now()
       returning id, (xmax = 0) as inserted`,
      [
        String(record.email).trim().toLowerCase(),
        passwordHash,
        Boolean(record.emailVerified),
        record.uid,
        toTimestamp(record.createdAt)
      ]
    )
    const userId = userRows[0].id
    const isNew = userRows[0].inserted

    // A re-run must not reset a password the parent has already changed, so
    // the hash is only written when the row is created.
    if (isNew) credentials.push({ email: record.email, password })

    const profile = record.profile ?? {}
    await client.query(
      `insert into profiles (user_id, plan, role, owner_id, chat_name,
                             storage_used_bytes, storage_quota_bytes, pause_all_rules)
       values ($1, $2, $3, $1, $4, $5, $6, $7)
       on conflict (user_id) do update
         set plan = excluded.plan,
             role = excluded.role,
             chat_name = excluded.chat_name,
             storage_used_bytes = excluded.storage_used_bytes,
             storage_quota_bytes = excluded.storage_quota_bytes,
             pause_all_rules = excluded.pause_all_rules,
             updated_at = now()`,
      [
        userId,
        profile.plan ?? 'free',
        profile.role ?? 'owner',
        profile.chatName ?? null,
        Number(profile.storageUsedBytes ?? 0),
        Number(profile.storageQuotaBytes ?? 100 * 1024 * 1024),
        Boolean(record.root?.pauseAllRules)
      ]
    )
    totals.accounts++

    for (const device of record.devices) {
      const d = device.data ?? {}
      // Device settings lived at the top level of the Firestore document, and
      // that is where the panel and the agent still read them. Only the
      // columns are lifted out; everything else goes to settings.
      const OWNED = new Set([
        'hostname', 'osType', 'deviceName', 'alias', 'agentVersion', 'status',
        'lastSeen', 'pairedAt', 'pomodoroState', 'recentLogs',
        // Deliberately dropped: the secret does not come across. Agents get a
        // new build and re-pair, and importing a secret nobody can use would
        // only make a device look connected when it is not.
        'screenshotUploadToken', 'agentUid'
      ])
      const settings = {}
      for (const [key, value] of Object.entries(d)) {
        if (!OWNED.has(key)) settings[key] = value
      }

      const { rows: deviceRows } = await client.query(
        `insert into devices (owner_id, hostname, os_type, device_name, alias,
                              agent_version, status, last_seen, paired_at,
                              settings, pomodoro_state, recent_logs, legacy_id)
         values ($1, $2, $3, $4, $5, $6, 'offline', $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
         on conflict (legacy_id) do update
           set hostname = excluded.hostname,
               os_type = excluded.os_type,
               device_name = excluded.device_name,
               alias = excluded.alias,
               agent_version = excluded.agent_version,
               settings = excluded.settings,
               pomodoro_state = excluded.pomodoro_state,
               updated_at = now()
         returning id`,
        [
          userId, d.hostname ?? null, d.osType ?? null,
          d.deviceName ?? d.hostname ?? null, d.alias ?? null,
          d.agentVersion ?? null,
          toTimestamp(d.lastSeen), toTimestamp(d.pairedAt),
          JSON.stringify(settings),
          d.pomodoroState ? JSON.stringify(d.pomodoroState) : null,
          d.recentLogs ? JSON.stringify(d.recentLogs) : null,
          device.id
        ]
      )
      const deviceId = deviceRows[0].id
      totals.devices++

      for (const rule of device.rules) {
        const { slug, status, payload } = ruleParts(rule)
        await client.query(
          `insert into rules (device_id, slug, status, payload, legacy_id, created_at, updated_at)
           values ($1, $2, $3, $4::jsonb, $5, coalesce($6::timestamptz, now()), now())
           on conflict (device_id, legacy_id) where legacy_id is not null do update
             set status = excluded.status,
                 payload = excluded.payload,
                 updated_at = now()`,
          [deviceId, slug, status, JSON.stringify(payload), rule.id, toTimestamp(rule.createdAt)]
        )
        totals.rules++
      }

      for (const app of device.apps) {
        await client.query(
          `insert into installed_apps (device_id, app_id, name, path, publisher, version)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (device_id, app_id) do update
             set name = excluded.name, path = excluded.path,
                 publisher = excluded.publisher, version = excluded.version,
                 updated_at = now()`,
          [deviceId, app.id, app.name ?? null, app.path ?? null,
            app.publisher ?? null, app.version ?? null]
        )
        totals.apps++
      }

      for (const stat of device.activityStats) {
        const date = stat.date ?? stat.id
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) continue
        await client.query(
          `insert into activity_stats (device_id, date, counters)
           values ($1, $2, $3::jsonb)
           on conflict (device_id, date) do update
             set counters = excluded.counters, updated_at = now()`,
          [deviceId, date, JSON.stringify(flattenCounters(stat))]
        )
        totals.stats++
      }

      // Keyed by the Firestore id, so a second run replaces exactly what the
      // first one imported. Deleting everything for the device instead would
      // throw away what the agent has reported to this server in between.
      for (const entry of device.activityLogs) {
        const { id, ts, type, ...rest } = entry
        await client.query(
          `insert into activity_logs (device_id, ts, kind, payload, legacy_id)
           values ($1, coalesce($2::timestamptz, now()), $3, $4::jsonb, $5)
           on conflict (device_id, legacy_id) where legacy_id is not null do update
             set ts = excluded.ts, kind = excluded.kind, payload = excluded.payload`,
          [deviceId, toTimestamp(ts), type ?? 'unknown', JSON.stringify(rest), id ?? null]
        )
        totals.logs++
      }
    }

    // Alerts reference the device by its Firestore id; map it to the new one.
    const { rows: deviceMap } = await client.query(
      'select id, legacy_id from devices where owner_id = $1 and legacy_id is not null',
      [userId]
    )
    const byLegacy = new Map(deviceMap.map(row => [row.legacy_id, row.id]))

    for (const alert of record.alerts) {
      await client.query(
        `insert into alerts (owner_id, device_id, type, details, device_hostname,
                             acknowledged, created_at, legacy_id)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8)
         on conflict (owner_id, legacy_id) where legacy_id is not null do update
           set device_id = excluded.device_id,
               acknowledged = excluded.acknowledged`,
        [
          userId,
          byLegacy.get(alert.deviceId) ?? null,
          alert.type ?? 'unknown',
          alert.details ?? null,
          alert.deviceHostname ?? null,
          Boolean(alert.acknowledged),
          toTimestamp(alert.timestamp),
          alert.id ?? null
        ]
      )
      totals.alerts++
    }
  })

  console.log(`  ${record.email}: перенесён`)
}

console.log(`\n${dryRun ? 'Пробный прогон (ничего не записано)' : 'Импорт завершён'}:`)
console.log(`  аккаунтов: ${totals.accounts}`)
console.log(`  устройств: ${totals.devices}`)
console.log(`  правил:    ${totals.rules}`)
console.log(`  программ:  ${totals.apps}`)
console.log(`  событий:   ${totals.logs}`)
console.log(`  дней статистики: ${totals.stats}`)
console.log(`  уведомлений: ${totals.alerts}`)

if (credentials.length > 0) {
  console.log('\nВременные пароли — передать владельцам лично, они меняются при первом входе:')
  for (const { email, password } of credentials) {
    console.log(`  ${email.padEnd(36)} ${password}`)
  }
  console.log('\nЭтот вывод больше нигде не сохраняется. Скопируйте его сейчас.')
}

console.log('\nУстройства перенесены без секретов: агенты нужно перепривязать')
console.log('ремонтным кодом — правила и история при этом сохранятся.')

await pool.end()
