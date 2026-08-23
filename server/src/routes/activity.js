import { query } from '../db.js'
import { notFound } from '../errors.js'
import { requireParent } from '../auth/guard.js'

// A day of activity on an active machine is a few hundred rows. The panel
// shows one day at a time, so it is fetched a day at a time.
const LOG_LIMIT = 500

const deviceParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

const DATE_RE = '^\\d{4}-\\d{2}-\\d{2}$'

/**
 * Turns 'appsUsage.chrome' back into { appsUsage: { chrome: … } }.
 *
 * Counters are stored flat because that is what can be summed in one
 * statement, but the panel was written against Firestore's nested documents
 * and reads stat.appsUsage[name]. Restoring the shape here means the charts do
 * not have to know which backend produced them.
 *
 * One level of nesting only: that is all the agent produces, and a general
 * unflatten would happily build a structure out of a program named "a.b.c".
 */
function unflatten(counters) {
  const result = {}
  for (const [key, value] of Object.entries(counters ?? {})) {
    const dot = key.indexOf('.')
    if (dot === -1) {
      result[key] = value
      continue
    }
    const group = key.slice(0, dot)
    const name = key.slice(dot + 1)
    if (typeof result[group] !== 'object' || result[group] === null) result[group] = {}
    result[group][name] = value
  }
  return result
}

export default async function activityRoutes(app) {
  app.addHook('preHandler', requireParent)

  async function assertOwnsDevice(ownerId, deviceId) {
    const { rows } = await query(
      'select 1 from devices where id = $1 and owner_id = $2',
      [deviceId, ownerId]
    )
    if (rows.length === 0) throw notFound('device_not_found', 'Устройство не найдено.')
  }

  // Events for one day. The day is bounded by the caller's timezone offset,
  // not the server's: a child's evening belongs to that evening even when the
  // server keeps time in UTC.
  app.get('/devices/:id/activity/logs', {
    schema: {
      params: deviceParams,
      querystring: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: DATE_RE },
          tzOffsetMinutes: { type: 'integer', minimum: -840, maximum: 840 }
        },
        additionalProperties: false
      }
    }
  }, async (request) => {
    await assertOwnsDevice(request.userId, request.params.id)

    const date = request.query.date ?? new Date().toISOString().slice(0, 10)
    const offset = request.query.tzOffsetMinutes ?? 0

    const { rows } = await query(
      `select id, ts, kind, payload
         from activity_logs
        where device_id = $1
          and ts >= ($2::date - make_interval(mins => $3))
          and ts <  ($2::date + interval '1 day' - make_interval(mins => $3))
        order by ts desc
        limit ${LOG_LIMIT}`,
      [request.params.id, date, offset]
    )

    return {
      logs: rows.map(row => ({
        id: String(row.id),
        ts: row.ts.toISOString(),
        kind: row.kind,
        ...row.payload
      }))
    }
  })

  // Per-day counters for charts.
  app.get('/devices/:id/activity/stats', {
    schema: {
      params: deviceParams,
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', pattern: DATE_RE },
          to: { type: 'string', pattern: DATE_RE },
          days: { type: 'integer', minimum: 1, maximum: 400 }
        },
        additionalProperties: false
      }
    }
  }, async (request) => {
    await assertOwnsDevice(request.userId, request.params.id)

    const { from, to, days } = request.query
    const rows = from || to
      ? (await query(
          `select date, counters from activity_stats
            where device_id = $1
              and ($2::date is null or date >= $2::date)
              and ($3::date is null or date <= $3::date)
            order by date desc`,
          [request.params.id, from ?? null, to ?? null]
        )).rows
      : (await query(
          `select date, counters from activity_stats
            where device_id = $1 and date > current_date - make_interval(days => $2)
            order by date desc`,
          [request.params.id, days ?? 7]
        )).rows

    return {
      stats: rows.map(row => ({
        // Date, not a timestamp: the column is a date and node-postgres would
        // otherwise hand back a Date at local midnight, which shifts the day
        // across a timezone boundary.
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
        ...unflatten(row.counters)
      }))
    }
  })
}
