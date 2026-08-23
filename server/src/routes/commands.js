import { query } from '../db.js'
import { badRequest, conflict, notFound } from '../errors.js'
import { requireParent } from '../auth/guard.js'
import { APP_COLUMNS, COMMAND_COLUMNS, serializeApp, serializeCommand } from '../serializers.js'

// Same list the Cloud Function allowed. An allowlist rather than free text:
// the agent acts on these on a child's machine, and "whatever the client
// sent" is not something that should reach a power action.
const ALLOWED_ACTIONS = [
  'lock', 'unlock', 'screenshot_request', 'fetch_logs',
  'shutdown', 'restart', 'sleep', 'hibernate',
  'update_agent', 'force_update', 'uninstall'
]

// A parent pressing a button while the child's PC is off should not be able to
// queue an unbounded pile that all executes at once when it comes back.
const MAX_PENDING = 50

const commandSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ALLOWED_ACTIONS },
    // The panel has historically sent either name.
    command: { type: 'string', enum: ALLOWED_ACTIONS },
    message: { type: 'string', maxLength: 500 },
    appId: { type: 'string', maxLength: 100 },
    requestedAtClientMs: { type: 'number' }
  },
  additionalProperties: false
}

const deviceParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

export default async function commandRoutes(app) {
  app.addHook('preHandler', requireParent)

  // Ownership is checked separately from the read, so someone else's device
  // answers 404 rather than an empty list. An empty list is an answer — it
  // says the device exists and has nothing installed.
  async function assertOwnsDevice(ownerId, deviceId) {
    const { rows } = await query(
      'select 1 from devices where id = $1 and owner_id = $2',
      [deviceId, ownerId]
    )
    if (rows.length === 0) throw notFound('device_not_found', 'Устройство не найдено.')
  }

  app.get('/devices/:id/apps', { schema: { params: deviceParams } }, async (request) => {
    await assertOwnsDevice(request.userId, request.params.id)
    const { rows } = await query(
      `select ${APP_COLUMNS} from installed_apps where device_id = $1 order by lower(name)`,
      [request.params.id]
    )
    return { apps: rows.map(serializeApp) }
  })

  app.get('/devices/:id/commands', { schema: { params: deviceParams } }, async (request) => {
    await assertOwnsDevice(request.userId, request.params.id)
    const { rows } = await query(
      `select ${COMMAND_COLUMNS} from commands
        where device_id = $1
        order by created_at desc
        limit 100`,
      [request.params.id]
    )
    return { commands: rows.map(serializeCommand) }
  })

  app.post('/devices/:id/commands', {
    schema: { params: deviceParams, body: commandSchema }
  }, async (request, reply) => {
    const action = request.body.action || request.body.command
    if (!action) {
      throw badRequest('invalid_action', 'Не указано, что сделать.')
    }

    await assertOwnsDevice(request.userId, request.params.id)

    const { rows: pending } = await query(
      `select count(*)::int as n from commands where device_id = $1 and status = 'pending'`,
      [request.params.id]
    )
    if (pending[0].n >= MAX_PENDING) {
      throw conflict('too_many_pending_commands',
        'Устройство не отвечает — накопились неисполненные команды.')
    }

    const payload = {}
    if (request.body.message !== undefined) payload.message = request.body.message
    if (request.body.appId !== undefined) payload.appId = request.body.appId
    if (request.body.requestedAtClientMs !== undefined) {
      payload.requestedAtClientMs = request.body.requestedAtClientMs
    }

    const { rows } = await query(
      `insert into commands (device_id, action, payload)
       values ($1, $2, $3::jsonb)
       returning ${COMMAND_COLUMNS}`,
      [request.params.id, action, JSON.stringify(payload)]
    )

    const command = serializeCommand(rows[0])
    // commandId at the top level: that is what the callable function returned
    // and what the panel reads.
    return reply.code(201).send({ commandId: command.id, command })
  })
}
