// Children, and which devices belong to them.
//
// The devices themselves are managed in devices.js; the only thing that lives
// here is who a device belongs to.

import { badRequest, notFound } from '../errors.js'
import { query } from '../db.js'
import { requireParent } from '../auth/guard.js'
import { CHILD_COLUMNS, serializeChild } from '../serializers.js'

const bodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 },
    // An emoji is a handful of code points, not a handful of characters —
    // '👨‍👩‍👧' alone is eleven. The limit is generous for that reason and the
    // value is only ever shown, never interpreted.
    avatar: { type: 'string', maxLength: 32 },
    note: { type: ['string', 'null'], maxLength: 300 }
  },
  additionalProperties: false
}

const createSchema = { ...bodySchema, required: ['name'] }
const patchSchema = { ...bodySchema, minProperties: 1 }

const childParams = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id']
}

export default async function childRoutes(app) {
  app.addHook('preHandler', requireParent)

  app.get('/children', async (request) => {
    const { rows } = await query(
      `select ${CHILD_COLUMNS},
              coalesce(
                (select array_agg(d.id order by d.paired_at desc nulls last)
                   from devices d where d.child_id = c.id),
                '{}'
              ) as device_ids
         from children c
        where c.owner_id = $1
        order by c.created_at`,
      [request.ownerId]
    )
    return { children: rows.map(serializeChild) }
  })

  app.post('/children', { schema: { body: createSchema } }, async (request) => {
    const name = request.body.name.trim()
    if (!name) throw badRequest('name_required', 'Укажите имя ребёнка.')

    const { rows } = await query(
      `insert into children (owner_id, name, avatar, note)
       values ($1, $2, coalesce($3, '🙂'), $4)
       returning ${CHILD_COLUMNS}`,
      [request.ownerId, name, request.body.avatar ?? null, request.body.note ?? null]
    )
    return serializeChild({ ...rows[0], device_ids: [] })
  })

  app.patch('/children/:id', {
    schema: { params: childParams, body: patchSchema }
  }, async (request) => {
    const updates = []
    const values = [request.params.id, request.ownerId]

    if (request.body.name !== undefined) {
      const name = request.body.name.trim()
      if (!name) throw badRequest('name_required', 'Укажите имя ребёнка.')
      values.push(name)
      updates.push(`name = $${values.length}`)
    }
    if (request.body.avatar !== undefined) {
      values.push(request.body.avatar)
      updates.push(`avatar = $${values.length}`)
    }
    if (request.body.note !== undefined) {
      values.push(request.body.note)
      updates.push(`note = $${values.length}`)
    }

    const { rows } = await query(
      `update children set ${updates.join(', ')}, updated_at = now()
        where id = $1 and owner_id = $2
        returning ${CHILD_COLUMNS}`,
      values
    )
    if (!rows[0]) throw notFound('child_not_found', 'Профиль ребёнка не найден.')

    const { rows: devices } = await query(
      'select id from devices where child_id = $1 order by paired_at desc nulls last',
      [request.params.id]
    )
    return serializeChild({ ...rows[0], device_ids: devices.map(d => d.id) })
  })

  // Removing a child leaves their devices in place, unassigned. Deleting the
  // devices too would mean a mistyped click wipes the history and pairing of a
  // PC that is still sitting in the child's room — and re-pairing it needs
  // physical access to that machine.
  app.delete('/children/:id', { schema: { params: childParams } }, async (request, reply) => {
    const { rows } = await query(
      'delete from children where id = $1 and owner_id = $2 returning id',
      [request.params.id, request.ownerId]
    )
    if (!rows[0]) throw notFound('child_not_found', 'Профиль ребёнка не найден.')
    reply.code(204)
  })
}
