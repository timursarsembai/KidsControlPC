// Screenshots: the agent uploads, the parent looks and deletes.

import { query, withTransaction } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { requireAgent, requireParent } from '../auth/guard.js'
import { deleteFile, readFileStream, saveFile, screenshotPath } from '../storage/files.js'

// One screenshot of a 1080p screen at the quality the agent uses is a few
// hundred kilobytes. Ten megabytes is not a screenshot.
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

function serializeScreenshot(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    source: row.source,
    size: Number(row.size_bytes),
    width: row.width,
    quality: row.quality,
    status: row.status,
    timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null
  }
}

const SCREENSHOT_COLUMNS = `id, device_id, owner_id, path, size_bytes, source,
                            width, quality, status, created_at, expires_at`

const deviceParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
}

export default async function screenshotRoutes(app) {
  // The agent sends the image as the request body. Not multipart: building a
  // multipart body by hand over the raw https module — which is all pkg on
  // Node 18.5 leaves us — is a lot of fiddly code for no gain.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  app.post('/agent/screenshots', {
    preHandler: requireAgent,
    bodyLimit: MAX_SCREENSHOT_BYTES,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          source: { type: 'string', maxLength: 30 },
          width: { type: 'integer', minimum: 1, maximum: 10000 },
          quality: { type: 'integer', minimum: 1, maximum: 100 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const image = request.body
    if (!Buffer.isBuffer(image) || image.length === 0) {
      throw conflict('empty_upload', 'Empty screenshot.')
    }

    const { rows: device } = await query(
      `select d.owner_id, p.storage_used_bytes, p.storage_quota_bytes
         from devices d
         join device_secrets s on s.device_id = d.id
         left join profiles p on p.user_id = d.owner_id
        where d.id = $1`,
      [request.deviceId]
    )
    if (!device[0]) throw notFound('device_unpaired', 'Device is no longer paired.')

    const used = Number(device[0].storage_used_bytes ?? 0)
    const quota = Number(device[0].storage_quota_bytes ?? 0)

    // Refused rather than silently dropping the oldest: deleting a parent's
    // evidence to make room for a newer picture is not a decision this code
    // gets to make quietly.
    if (quota > 0 && used + image.length > quota) {
      throw conflict('storage_quota_exceeded',
        'Хранилище заполнено — удалите старые скриншоты.')
    }

    const relativePath = screenshotPath(device[0].owner_id, request.deviceId)
    await saveFile(relativePath, image)

    try {
      const { rows } = await withTransaction(async (client) => {
        const inserted = await client.query(
          `insert into screenshots (device_id, owner_id, path, size_bytes, source, width, quality)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning ${SCREENSHOT_COLUMNS}`,
          [
            request.deviceId, device[0].owner_id, relativePath, image.length,
            request.query.source ?? null, request.query.width ?? null,
            request.query.quality ?? null
          ]
        )
        await client.query(
          `update profiles set storage_used_bytes = storage_used_bytes + $2, updated_at = now()
            where user_id = $1`,
          [device[0].owner_id, image.length]
        )
        return inserted
      })
      return reply.code(201).send(serializeScreenshot(rows[0]))
    } catch (err) {
      // The row is what makes the file findable. Without it the file is
      // invisible to everyone, counted by nobody, and deleted by nothing.
      await deleteFile(relativePath)
      throw err
    }
  })

  app.register(async (parent) => {
    parent.addHook('preHandler', requireParent)

    parent.get('/devices/:id/screenshots', { schema: { params: deviceParams } }, async (request) => {
      const { rows: owned } = await query(
        'select 1 from devices where id = $1 and owner_id = $2',
        [request.params.id, request.ownerId]
      )
      if (!owned[0]) throw notFound('device_not_found', 'Устройство не найдено.')

      const { rows } = await query(
        `select ${SCREENSHOT_COLUMNS} from screenshots
          where device_id = $1
          order by created_at desc
          limit 200`,
        [request.params.id]
      )
      return { screenshots: rows.map(serializeScreenshot) }
    })

    /**
     * The image itself.
     *
     * Authorised by the ordinary access token in the header, which means the
     * panel fetches it and makes an object URL rather than pointing an <img>
     * at it. A URL that carried its own credential would end up in the Nginx
     * access log, in the browser history, and in whatever a parent pastes into
     * a chat when asking for help.
     */
    parent.get('/screenshots/:id/file', { schema: { params: idParams } }, async (request, reply) => {
      const { rows } = await query(
        `select s.path, s.size_bytes
           from screenshots s
           join devices d on d.id = s.device_id
          where s.id = $1 and d.owner_id = $2`,
        [request.params.id, request.ownerId]
      )
      if (!rows[0]) throw notFound('screenshot_not_found', 'Скриншот не найден.')

      reply.header('Content-Type', 'image/jpeg')
      reply.header('Content-Length', String(rows[0].size_bytes))
      // Private: this is a picture of a child's screen, and no shared cache
      // has any business keeping a copy.
      reply.header('Cache-Control', 'private, max-age=300')
      return reply.send(readFileStream(rows[0].path))
    })

    parent.delete('/screenshots/:id', { schema: { params: idParams } }, async (request, reply) => {
      const removed = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `delete from screenshots s
            using devices d
            where s.id = $1 and d.id = s.device_id and d.owner_id = $2
            returning s.path, s.size_bytes, s.owner_id`,
          [request.params.id, request.ownerId]
        )
        if (!rows[0]) return null

        await client.query(
          `update profiles
              set storage_used_bytes = greatest(0, storage_used_bytes - $2),
                  updated_at = now()
            where user_id = $1`,
          [rows[0].owner_id, Number(rows[0].size_bytes)]
        )
        return rows[0]
      })

      if (!removed) throw notFound('screenshot_not_found', 'Скриншот не найден.')

      // After the transaction: a rollback must not leave the row pointing at a
      // file that is already gone.
      await deleteFile(removed.path)
      return reply.code(204).send()
    })

    /**
     * Recounts what is actually stored.
     *
     * The running total is kept incrementally, and any counter maintained that
     * way eventually drifts — an interrupted delete, a restore from backup.
     * This is the button that makes it agree with reality again.
     */
    parent.post('/storage/recalculate', async (request) => {
      const { rows } = await query(
        `update profiles p
            set storage_used_bytes = coalesce((
                  select sum(s.size_bytes) from screenshots s where s.owner_id = p.user_id
                ), 0),
                updated_at = now()
          where p.user_id = $1
          returning storage_used_bytes, storage_quota_bytes`,
        [request.ownerId]
      )
      return {
        storageUsedBytes: Number(rows[0]?.storage_used_bytes ?? 0),
        storageQuotaBytes: Number(rows[0]?.storage_quota_bytes ?? 0)
      }
    })
  })
}
