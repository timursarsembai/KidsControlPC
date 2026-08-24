import { query } from '../db.js'
import { requireParent } from '../auth/guard.js'
import { ALERT_COLUMNS, serializeAlert } from '../serializers.js'

// What a parent sees on one screen. The Firestore version pulled the whole
// collection and let the client sort it; a family that has run this for a year
// would be downloading thousands of rows to show twenty.
const PAGE_SIZE = 200

const ackAllSchema = {
  type: 'object',
  properties: {
    // Optional: the panel passes the ids it currently shows, so acknowledging
    // does not silently clear an alert that arrived while the parent was
    // reading and that they never saw.
    ids: {
      type: 'array',
      maxItems: 1000,
      items: { type: 'string', format: 'uuid' }
    }
  },
  additionalProperties: false
}

const alertParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

export default async function alertRoutes(app) {
  app.addHook('preHandler', requireParent)

  app.get('/alerts', async (request) => {
    const { rows } = await query(
      `select ${ALERT_COLUMNS} from alerts
        where owner_id = $1
        order by created_at desc
        limit ${PAGE_SIZE}`,
      [request.ownerId]
    )
    return { alerts: rows.map(serializeAlert) }
  })

  app.post('/alerts/:id/ack', { schema: { params: alertParams } }, async (request, reply) => {
    await query(
      'update alerts set acknowledged = true where id = $1 and owner_id = $2',
      [request.params.id, request.ownerId]
    )
    // No 404 for an alert that is already gone: the parent asked for it to
    // stop showing, and it is not showing.
    return reply.code(204).send()
  })

  app.post('/alerts/ack-all', { schema: { body: ackAllSchema } }, async (request, reply) => {
    const ids = request.body?.ids
    if (ids && ids.length > 0) {
      await query(
        'update alerts set acknowledged = true where owner_id = $1 and id = any($2::uuid[])',
        [request.ownerId, ids]
      )
    } else {
      await query(
        'update alerts set acknowledged = true where owner_id = $1 and acknowledged = false',
        [request.ownerId]
      )
    }
    return reply.code(204).send()
  })
}
