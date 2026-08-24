import { query } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { requireParent } from '../auth/guard.js'
import { RULE_COLUMNS, serializeRule } from '../serializers.js'

// A rule's own fields stay free-form. They change with almost every agent
// release — a new kind of block, a new schedule shape — and pinning them down
// here would mean a migration and a server deploy for each one, in lockstep
// with an agent rollout that takes days to reach every child's PC.
//
// What is fixed is only what the server itself acts on.
const SERVER_OWNED = new Set(['id', 'deviceId', 'device_id', 'slug', 'status',
  'createdAt', 'created_at', 'updatedAt', 'updated_at'])

function splitRuleBody(body) {
  const payload = {}
  for (const [key, value] of Object.entries(body)) {
    if (SERVER_OWNED.has(key)) continue
    payload[key] = value
  }
  return payload
}

const STATUS_VALUES = ['active', 'inactive']

const MAX_RULES_PER_DEVICE = 500

const ruleBodySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: STATUS_VALUES }
  },
  // Everything else is the rule itself and is stored as given.
  additionalProperties: true
}

const deviceParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

const ruleParams = {
  type: 'object',
  required: ['id', 'ruleId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    ruleId: { type: 'string', format: 'uuid' }
  }
}

const slugParams = {
  type: 'object',
  required: ['id', 'slug'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    // Fixed-id rules the panel addresses by name, e.g. global_pomodoro.
    slug: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,48}$' }
  }
}

async function assertOwnsDevice(ownerId, deviceId) {
  const { rows } = await query(
    'select 1 from devices where id = $1 and owner_id = $2',
    [deviceId, ownerId]
  )
  if (rows.length === 0) throw notFound('device_not_found', 'Устройство не найдено.')
}

export default async function ruleRoutes(app) {
  app.addHook('preHandler', requireParent)

  app.get('/devices/:id/rules', { schema: { params: deviceParams } }, async (request) => {
    await assertOwnsDevice(request.ownerId, request.params.id)
    const { rows } = await query(
      `select ${RULE_COLUMNS} from rules where device_id = $1 order by created_at desc`,
      [request.params.id]
    )
    return { rules: rows.map(serializeRule) }
  })

  app.post('/devices/:id/rules', {
    schema: { params: deviceParams, body: ruleBodySchema }
  }, async (request, reply) => {
    await assertOwnsDevice(request.ownerId, request.params.id)

    // Every rule is pushed to the agent on every reconnect, so an unbounded
    // list is not just clutter — it is what a child's PC has to download and
    // evaluate on each start. No real device needs hundreds.
    const { rows: counted } = await query(
      'select count(*)::int as n from rules where device_id = $1',
      [request.params.id]
    )
    if (counted[0].n >= MAX_RULES_PER_DEVICE) {
      throw conflict('too_many_rules',
        `На устройстве уже ${MAX_RULES_PER_DEVICE} правил — удалите ненужные.`)
    }

    const { rows } = await query(
      `insert into rules (device_id, status, payload)
       values ($1, $2, $3::jsonb)
       returning ${RULE_COLUMNS}`,
      [request.params.id, request.body.status ?? 'active', JSON.stringify(splitRuleBody(request.body))]
    )
    return reply.code(201).send(serializeRule(rows[0]))
  })

  app.patch('/devices/:id/rules/:ruleId', {
    schema: { params: ruleParams, body: ruleBodySchema }
  }, async (request) => {
    const patch = splitRuleBody(request.body)

    // Merge rather than replace. The panel sends the field the parent just
    // edited; a replace would silently drop everything a newer agent added to
    // the rule that this panel build knows nothing about.
    const { rows } = await query(
      `update rules r
          set payload = r.payload || $4::jsonb,
              status = coalesce($5, r.status),
              updated_at = now()
        from devices d
       where r.id = $1 and r.device_id = $2 and d.id = r.device_id and d.owner_id = $3
       returning ${RULE_COLUMNS.split(', ').map(c => `r.${c}`).join(', ')}`,
      [
        request.params.ruleId,
        request.params.id,
        request.ownerId,
        JSON.stringify(patch),
        request.body.status ?? null
      ]
    )
    if (!rows[0]) throw notFound('rule_not_found', 'Правило не найдено.')
    return serializeRule(rows[0])
  })

  // Fixed-id rules — the pomodoro settings are the one in use today. Upsert
  // because the panel has no separate "create" step for them: the parent just
  // saves, and whether a row already exists is not their problem.
  app.put('/devices/:id/rules/slug/:slug', {
    schema: { params: slugParams, body: ruleBodySchema }
  }, async (request) => {
    await assertOwnsDevice(request.ownerId, request.params.id)

    const { rows } = await query(
      `insert into rules (device_id, slug, status, payload)
       values ($1, $2, coalesce($3, 'active'), $4::jsonb)
       -- The predicate is required: rules_device_slug_key is a partial index
       -- (slug is null for ordinary rules, and many of those may share a
       -- device), and Postgres will not match a partial index unless the
       -- conflict target repeats its condition.
       on conflict (device_id, slug) where slug is not null do update
         set payload = rules.payload || excluded.payload,
             -- Only when the caller said so. Defaulting to 'active' here
             -- would silently switch a rule back on every time a parent saved
             -- an unrelated setting on it.
             status = coalesce($3, rules.status),
             updated_at = now()
       returning ${RULE_COLUMNS}`,
      [
        request.params.id,
        request.params.slug,
        request.body.status ?? null,
        JSON.stringify(splitRuleBody(request.body))
      ]
    )
    return serializeRule(rows[0])
  })

  app.delete('/devices/:id/rules/:ruleId', {
    schema: { params: ruleParams }
  }, async (request, reply) => {
    const { rowCount } = await query(
      `delete from rules r
        using devices d
        where r.id = $1 and r.device_id = $2 and d.id = r.device_id and d.owner_id = $3`,
      [request.params.ruleId, request.params.id, request.ownerId]
    )
    if (rowCount === 0) throw notFound('rule_not_found', 'Правило не найдено.')
    return reply.code(204).send()
  })
}
