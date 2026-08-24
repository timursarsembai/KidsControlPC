// Chat between a parent and a child's PC.
//
// Two audiences share these tables: the panel, which acts as a parent, and the
// agent, which acts as one device. They see the same messages and mark the
// same boxes, so the shapes here are deliberately identical for both.

import { query, withTransaction } from '../db.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { requireAgent, requireParent } from '../auth/guard.js'
import { deleteFile, readFileStream, saveFile } from '../storage/files.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

// An attachment is a photo or a document a parent sends a child. Bigger than a
// screenshot because a parent might send a scan of a timetable.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MESSAGE_PAGE = 200

function serializeChat(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    ownerUid: row.owner_id,
    createdBy: row.created_by,
    deviceIds: row.device_ids ?? [],
    parentUids: row.parent_ids ?? [],
    lastMessage: row.last_message ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  }
}

function serializeMessage(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    text: row.text,
    senderType: row.sender_type,
    senderUid: row.sender_user_id,
    senderDeviceId: row.sender_device_id,
    senderName: row.sender_name,
    fileName: row.file_name,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    mimeType: row.mime_type,
    fileDeleted: row.file_deleted,
    // The panel fetches the bytes through this, the same way it does with
    // screenshots — with a token in the header, not in a URL.
    fileUrl: row.file_path && !row.file_deleted ? `/chats/messages/${row.id}/file` : null,
    gifUrl: row.gif_url,
    gifPreviewUrl: row.gif_preview_url,
    readBy: row.read_by ?? [],
    deliveredTo: row.delivered_to ?? [],
    timestamp: row.created_at ? new Date(row.created_at).toISOString() : null
  }
}

const CHAT_COLUMNS = `id, owner_id, type, name, created_by, device_ids, parent_ids,
                      last_message, created_at, updated_at`
const MESSAGE_COLUMNS = `id, chat_id, text, sender_type, sender_user_id, sender_device_id,
                         sender_name, file_path, file_name, file_size, mime_type,
                         file_deleted, gif_url, gif_preview_url, read_by, delivered_to,
                         created_at`

const chatParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

// The last line shown in the chat list. An attachment has no text of its own,
// so it gets a stand-in — an empty row in the list looks like a bug.
function lastMessagePreview({ text, fileName, gifUrl, senderName }) {
  const preview = fileName ? `📎 ${fileName}` : (gifUrl ? '🖼️ GIF' : text)
  return { text: preview ?? '', senderName: senderName ?? '', timestamp: new Date().toISOString() }
}

export default async function chatRoutes(app) {
  app.addContentTypeParser(
    ['application/octet-stream', 'image/png', 'image/jpeg', 'application/pdf'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body)
  )

  // ── Parent side ──────────────────────────────────────────────────────────
  app.register(async (parent) => {
    parent.addHook('preHandler', requireParent)

    parent.get('/chats', async (request) => {
      const { rows } = await query(
        `select ${CHAT_COLUMNS} from chats
          where owner_id = $1
            -- Direct chats are private to the parent who started them; group
            -- chats are for everyone on the account. Same rule the Firebase
            -- panel applied client-side, moved to where it cannot be skipped.
            and (type <> 'direct' or created_by is null or created_by = $2)
          order by updated_at desc`,
        [request.ownerId, request.userId]
      )
      return { chats: rows.map(serializeChat) }
    })

    parent.post('/chats', {
      schema: {
        body: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['direct', 'group'] },
            name: { type: 'string', maxLength: 100 },
            deviceIds: { type: 'array', maxItems: 50, items: { type: 'string', format: 'uuid' } },
            parentUids: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } }
          },
          additionalProperties: false
        }
      }
    }, async (request, reply) => {
      const deviceIds = request.body.deviceIds ?? []

      // Every device has to belong to this account. Without the check a chat
      // could be pointed at someone else's device, and the agent on it would
      // happily join the conversation.
      if (deviceIds.length > 0) {
        const { rows } = await query(
          'select count(*)::int as n from devices where owner_id = $1 and id = any($2::uuid[])',
          [request.ownerId, deviceIds]
        )
        if (rows[0].n !== deviceIds.length) {
          throw badRequest('unknown_device', 'В списке есть чужое устройство.')
        }
      }

      const { rows } = await query(
        `insert into chats (owner_id, type, name, created_by, device_ids, parent_ids)
         values ($1, $2, $3, $4, $5::uuid[], $6::uuid[])
         returning ${CHAT_COLUMNS}`,
        [
          request.ownerId,
          request.body.type ?? 'direct',
          request.body.name ?? '',
          request.userId,
          deviceIds,
          request.body.parentUids ?? []
        ]
      )
      return reply.code(201).send(serializeChat(rows[0]))
    })

    parent.patch('/chats/:id', {
      schema: {
        params: chatParams,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 100 },
            deviceIds: { type: 'array', maxItems: 50, items: { type: 'string', format: 'uuid' } },
            parentUids: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } }
          },
          additionalProperties: false,
          minProperties: 1
        }
      }
    }, async (request) => {
      const { rows } = await query(
        `update chats
            set name = coalesce($3, name),
                device_ids = coalesce($4::uuid[], device_ids),
                parent_ids = coalesce($5::uuid[], parent_ids),
                updated_at = now()
          where id = $1 and owner_id = $2
          returning ${CHAT_COLUMNS}`,
        [
          request.params.id, request.ownerId,
          request.body.name ?? null,
          request.body.deviceIds ?? null,
          request.body.parentUids ?? null
        ]
      )
      if (!rows[0]) throw notFound('chat_not_found', 'Чат не найден.')
      return serializeChat(rows[0])
    })

    parent.delete('/chats/:id', { schema: { params: chatParams } }, async (request, reply) => {
      const files = await withTransaction(async (client) => {
        const { rows: attachments } = await client.query(
          `select m.file_path, m.file_size from chat_messages m
             join chats c on c.id = m.chat_id
            where m.chat_id = $1 and c.owner_id = $2
              and m.file_path is not null and m.file_deleted = false`,
          [request.params.id, request.ownerId]
        )
        const { rowCount } = await client.query(
          'delete from chats where id = $1 and owner_id = $2',
          [request.params.id, request.ownerId]
        )
        if (rowCount === 0) return null

        // Without this the space stays counted against the account forever:
        // the files are gone, the quota still says they are there.
        const freed = attachments.reduce((sum, row) => sum + Number(row.file_size ?? 0), 0)
        if (freed > 0) {
          await client.query(
            `update profiles set storage_used_bytes = greatest(0, storage_used_bytes - $2),
                                 updated_at = now()
              where user_id = $1`,
            [request.ownerId, freed]
          )
        }
        return attachments.map(row => row.file_path)
      })

      if (files === null) throw notFound('chat_not_found', 'Чат не найден.')
      // Messages go by cascade; their attachments do not.
      for (const path of files) await deleteFile(path)
      return reply.code(204).send()
    })

    parent.get('/chats/:id/messages', { schema: { params: chatParams } }, async (request) => {
      await assertParentInChat(request.params.id, request.ownerId, request.userId)
      const { rows } = await query(
        `select ${MESSAGE_COLUMNS} from chat_messages
          where chat_id = $1 order by created_at asc limit ${MESSAGE_PAGE}`,
        [request.params.id]
      )
      return { messages: rows.map(serializeMessage) }
    })

    parent.post('/chats/:id/messages', {
      schema: {
        params: chatParams,
        body: {
          type: 'object',
          properties: {
            text: { type: 'string', maxLength: 4000 },
            senderName: { type: 'string', maxLength: 100 },
            gifUrl: { type: 'string', maxLength: 500 },
            gifPreviewUrl: { type: 'string', maxLength: 500 }
          },
          additionalProperties: false
        }
      }
    }, async (request, reply) => {
      await assertParentInChat(request.params.id, request.ownerId, request.userId)

      const text = request.body.text ?? ''
      if (!text.trim() && !request.body.gifUrl) {
        throw badRequest('empty_message', 'Пустое сообщение.')
      }

      const message = await insertMessage({
        chatId: request.params.id,
        text,
        senderType: 'parent',
        senderUserId: request.userId,
        senderName: request.body.senderName ?? '',
        gifUrl: request.body.gifUrl ?? null,
        gifPreviewUrl: request.body.gifPreviewUrl ?? null,
        // The sender has obviously seen their own message.
        seenBy: [request.userId]
      })
      return reply.code(201).send(serializeMessage(message))
    })

    // Attachment upload: bytes in the body, name and type in the query, for
    // the same reason screenshots work that way.
    parent.post('/chats/:id/attachments', {
      bodyLimit: MAX_ATTACHMENT_BYTES,
      schema: {
        params: chatParams,
        querystring: {
          type: 'object',
          required: ['fileName'],
          properties: {
            fileName: { type: 'string', minLength: 1, maxLength: 200 },
            mimeType: { type: 'string', maxLength: 100 },
            senderName: { type: 'string', maxLength: 100 },
            text: { type: 'string', maxLength: 4000 }
          },
          additionalProperties: false
        }
      }
    }, async (request, reply) => {
      await assertParentInChat(request.params.id, request.ownerId, request.userId)

      const body = request.body
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw badRequest('empty_upload', 'Пустой файл.')
      }

      const { rows: quota } = await query(
        'select storage_used_bytes, storage_quota_bytes from profiles where user_id = $1',
        [request.ownerId]
      )
      const used = Number(quota[0]?.storage_used_bytes ?? 0)
      const limit = Number(quota[0]?.storage_quota_bytes ?? 0)
      if (limit > 0 && used + body.length > limit) {
        throw badRequest('storage_quota_exceeded', 'Хранилище заполнено.')
      }

      // Stored under the owner, like screenshots, so deleting an account takes
      // attachments with it.
      const relativePath = join(request.ownerId, 'chats', request.params.id, `${randomUUID()}`)
      await saveFile(relativePath, body)

      try {
        const message = await insertMessage({
          chatId: request.params.id,
          text: request.query.text ?? '',
          senderType: 'parent',
          senderUserId: request.userId,
          senderName: request.query.senderName ?? '',
          filePath: relativePath,
          fileName: request.query.fileName,
          fileSize: body.length,
          mimeType: request.query.mimeType ?? 'application/octet-stream',
          seenBy: [request.userId],
          ownerId: request.ownerId
        })
        return reply.code(201).send(serializeMessage(message))
      } catch (err) {
        await deleteFile(relativePath)
        throw err
      }
    })

    parent.get('/chats/messages/:id/file', {
      schema: { params: chatParams }
    }, async (request, reply) => {
      const { rows } = await query(
        `select m.file_path, m.file_size, m.mime_type, m.file_name, m.file_deleted
           from chat_messages m
           join chats c on c.id = m.chat_id
          where m.id = $1 and c.owner_id = $2`,
        [request.params.id, request.ownerId]
      )
      const message = rows[0]
      if (!message || !message.file_path) throw notFound('file_not_found', 'Файл не найден.')
      if (message.file_deleted) throw notFound('file_deleted', 'Файл удалён.')

      reply.header('Content-Type', message.mime_type || 'application/octet-stream')
      reply.header('Content-Length', String(message.file_size))
      reply.header('Cache-Control', 'private, max-age=300')
      return reply.send(readFileStream(message.file_path))
    })

    // Removes the file but keeps the message: the conversation stays readable,
    // and the panel shows the attachment as deleted rather than as broken.
    parent.post('/chats/messages/:id/delete-file', {
      schema: { params: chatParams }
    }, async (request, reply) => {
      const removed = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `update chat_messages m
              set file_deleted = true
             from chats c
            where m.id = $1 and c.id = m.chat_id and c.owner_id = $2
              and m.file_path is not null and m.file_deleted = false
            returning m.file_path, m.file_size`,
          [request.params.id, request.ownerId]
        )
        if (!rows[0]) return null
        await client.query(
          `update profiles set storage_used_bytes = greatest(0, storage_used_bytes - $2),
                               updated_at = now()
            where user_id = $1`,
          [request.ownerId, Number(rows[0].file_size ?? 0)]
        )
        return rows[0]
      })
      if (!removed) throw notFound('file_not_found', 'Файл не найден.')
      await deleteFile(removed.file_path)
      return reply.code(204).send()
    })

    parent.post('/chats/:id/read', { schema: { params: chatParams } }, async (request, reply) => {
      await markSeen(request.params.id, request.userId, 'read_by')
      return reply.code(204).send()
    })
  })

  // ── Agent side ───────────────────────────────────────────────────────────
  app.register(async (agent) => {
    agent.addHook('preHandler', requireAgent)

    // Chats this device takes part in. The device id comes from the token, so
    // an agent cannot ask about a conversation it is not in.
    agent.get('/agent/chats', async (request) => {
      const { rows } = await query(
        `select ${CHAT_COLUMNS} from chats
          where $1 = any(device_ids) order by updated_at desc`,
        [request.deviceId]
      )
      return { chats: rows.map(serializeChat) }
    })

    agent.get('/agent/chats/:id/messages', { schema: { params: chatParams } }, async (request) => {
      await assertDeviceInChat(request.params.id, request.deviceId)
      const { rows } = await query(
        `select ${MESSAGE_COLUMNS} from chat_messages
          where chat_id = $1 order by created_at asc limit ${MESSAGE_PAGE}`,
        [request.params.id]
      )
      return { messages: rows.map(serializeMessage) }
    })

    agent.post('/agent/chats/:id/messages', {
      schema: {
        params: chatParams,
        body: {
          type: 'object',
          properties: {
            text: { type: 'string', maxLength: 4000 },
            senderName: { type: 'string', maxLength: 100 }
          },
          additionalProperties: false
        }
      }
    }, async (request, reply) => {
      await assertDeviceInChat(request.params.id, request.deviceId)
      const text = request.body.text ?? ''
      if (!text.trim()) throw badRequest('empty_message', 'Empty message.')

      const message = await insertMessage({
        chatId: request.params.id,
        text,
        senderType: 'child',
        senderDeviceId: request.deviceId,
        senderName: request.body.senderName ?? '',
        seenBy: [request.deviceId]
      })
      return reply.code(201).send(serializeMessage(message))
    })

    // Delivery and read receipts, the same two boxes the parent side ticks.
    agent.post('/agent/chats/:id/delivered', { schema: { params: chatParams } }, async (request, reply) => {
      await assertDeviceInChat(request.params.id, request.deviceId)
      await markSeen(request.params.id, request.deviceId, 'delivered_to')
      return reply.code(204).send()
    })

    agent.post('/agent/chats/:id/read', { schema: { params: chatParams } }, async (request, reply) => {
      await assertDeviceInChat(request.params.id, request.deviceId)
      await markSeen(request.params.id, request.deviceId, 'read_by')
      return reply.code(204).send()
    })
  })
}

async function assertParentInChat(chatId, ownerId, userId) {
  const { rows } = await query(
    `select 1 from chats
      where id = $1 and owner_id = $2
        and (type <> 'direct' or created_by is null or created_by = $3)`,
    [chatId, ownerId, userId]
  )
  if (rows.length === 0) throw notFound('chat_not_found', 'Чат не найден.')
}

async function assertDeviceInChat(chatId, deviceId) {
  const { rows } = await query(
    'select 1 from chats where id = $1 and $2 = any(device_ids)',
    [chatId, deviceId]
  )
  if (rows.length === 0) throw forbidden('not_in_chat', 'Device is not part of this chat.')
}

/**
 * Adds a message and refreshes the chat's last line in one transaction.
 *
 * The two have to move together: a message without the list entry updated is a
 * conversation that looks unchanged in the panel until something else touches
 * it — which is exactly how a parent misses a child asking for something.
 */
async function insertMessage({
  chatId, text, senderType, senderUserId = null, senderDeviceId = null, senderName = '',
  filePath = null, fileName = null, fileSize = null, mimeType = null,
  gifUrl = null, gifPreviewUrl = null, seenBy = [], ownerId = null
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `insert into chat_messages
         (chat_id, text, sender_type, sender_user_id, sender_device_id, sender_name,
          file_path, file_name, file_size, mime_type, gif_url, gif_preview_url,
          read_by, delivered_to)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $13::text[])
       returning ${MESSAGE_COLUMNS}`,
      [
        chatId, text, senderType, senderUserId, senderDeviceId, senderName,
        filePath, fileName, fileSize, mimeType, gifUrl, gifPreviewUrl,
        seenBy.map(String)
      ]
    )

    await client.query(
      'update chats set last_message = $2::jsonb, updated_at = now() where id = $1',
      [chatId, JSON.stringify(lastMessagePreview({ text, fileName, gifUrl, senderName }))]
    )

    if (ownerId && fileSize) {
      await client.query(
        `update profiles set storage_used_bytes = storage_used_bytes + $2, updated_at = now()
          where user_id = $1`,
        [ownerId, fileSize]
      )
    }

    return rows[0]
  })
}

/**
 * Marks every message in a chat as seen by this reader.
 *
 * array_append only where the id is not already there: without the guard a
 * widget that reconnects every minute grows the array by one entry per
 * reconnect, and the row eventually stops fitting anywhere sensible.
 */
async function markSeen(chatId, readerId, column) {
  await query(
    `update chat_messages
        set ${column} = array_append(${column}, $2)
      where chat_id = $1 and not ($2 = any(${column}))`,
    [chatId, String(readerId)]
  )
}
