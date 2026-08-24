// Turns "row X changed" notifications into messages for whoever is watching.
//
// The row is read from the database here rather than carried in the trigger
// payload, so every subscriber gets the committed state and the same shape the
// REST routes produce.

import { query } from '../db.js'
import {
  ALERT_COLUMNS, APP_COLUMNS, CHILD_COLUMNS, COMMAND_COLUMNS, DEVICE_COLUMNS, RULE_COLUMNS,
  serializeAlert, serializeApp, serializeChild, serializeCommand, serializeDevice, serializeRule
} from '../serializers.js'
import { changes } from './changes.js'
import { channelFor } from './hub.js'

// No `ch` here: the hub fills it in per subscriber, under the name that
// subscriber used when it subscribed.
function patch(op, data) {
  return { t: 'patch', op, data }
}

async function dispatchDevice(hub, change) {
  const ownerChannel = change.ownerId ? channelFor.devices(change.ownerId) : null
  const deviceChannel = channelFor.device(change.deviceId)

  const watchedByOwner = ownerChannel && hub.hasSubscribers(ownerChannel)
  const watchedDirectly = hub.hasSubscribers(deviceChannel)

  // Nobody is looking. Skipping the read matters here specifically: a device
  // heartbeats every 30 seconds, so this path runs constantly for accounts
  // whose panel is closed — which is most of them, most of the time.
  if (!watchedByOwner && !watchedDirectly) return

  if (change.op === 'delete') {
    if (watchedByOwner) hub.broadcast(ownerChannel, patch('remove', { id: change.id }))
    if (watchedDirectly) hub.broadcast(deviceChannel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(
    `select ${DEVICE_COLUMNS} from devices where id = $1`,
    [change.id]
  )
  if (!rows[0]) return

  const device = serializeDevice(rows[0])
  if (watchedByOwner) hub.broadcast(ownerChannel, patch('upsert', device))
  if (watchedDirectly) hub.broadcast(deviceChannel, patch('upsert', device))
}

async function dispatchRule(hub, change) {
  const channel = channelFor.rules(change.deviceId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(`select ${RULE_COLUMNS} from rules where id = $1`, [change.id])
  if (!rows[0]) return

  hub.broadcast(channel, patch('upsert', serializeRule(rows[0])))
}

async function dispatchAlert(hub, change) {
  if (!change.ownerId) return
  const channel = channelFor.alerts(change.ownerId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(`select ${ALERT_COLUMNS} from alerts where id = $1`, [change.id])
  if (!rows[0]) return

  hub.broadcast(channel, patch('upsert', serializeAlert(rows[0])))
}

async function dispatchCommand(hub, change) {
  const channel = channelFor.commands(change.deviceId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(`select ${COMMAND_COLUMNS} from commands where id = $1`, [change.id])
  if (!rows[0]) return

  hub.broadcast(channel, patch('upsert', serializeCommand(rows[0])))
}

async function dispatchApp(hub, change) {
  const channel = channelFor.apps(change.deviceId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  // installed_apps is keyed by (device_id, app_id), so the change id is the
  // app id — unique only within its device.
  const { rows } = await query(
    `select ${APP_COLUMNS} from installed_apps where device_id = $1 and app_id = $2`,
    [change.deviceId, change.id]
  )
  if (!rows[0]) return

  hub.broadcast(channel, patch('upsert', serializeApp(rows[0])))
}

async function dispatchScreenshot(hub, change) {
  const channel = channelFor.screenshots(change.deviceId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(
    `select id, device_id, size_bytes, source, width, quality, status, created_at, expires_at
       from screenshots where id = $1`,
    [change.id]
  )
  if (!rows[0]) return

  const row = rows[0]
  hub.broadcast(channel, patch('upsert', {
    id: row.id,
    deviceId: row.device_id,
    source: row.source,
    size: Number(row.size_bytes),
    width: row.width,
    quality: row.quality,
    status: row.status,
    timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null
  }))
}

async function dispatchChild(hub, change) {
  if (!change.ownerId) return
  const channel = channelFor.children(change.ownerId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(
    `select ${CHILD_COLUMNS},
            coalesce(
              (select array_agg(d.id order by d.paired_at desc nulls last)
                 from devices d where d.child_id = c.id),
              '{}'
            ) as device_ids
       from children c where c.id = $1`,
    [change.id]
  )
  if (!rows[0]) return

  hub.broadcast(channel, patch('upsert', serializeChild(rows[0])))
}

async function dispatchChat(hub, change) {
  if (!change.ownerId) return
  const channel = channelFor.chats(change.ownerId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(
    `select id, owner_id, type, name, created_by, device_ids, parent_ids,
            last_message, created_at, updated_at
       from chats where id = $1`,
    [change.id]
  )
  if (!rows[0]) return
  const row = rows[0]
  hub.broadcast(channel, patch('upsert', {
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
  }))
}

async function dispatchChatMessage(hub, change) {
  if (!change.chatId) return
  const channel = channelFor.messages(change.chatId)
  if (!hub.hasSubscribers(channel)) return

  if (change.op === 'delete') {
    hub.broadcast(channel, patch('remove', { id: change.id }))
    return
  }

  const { rows } = await query(
    `select id, chat_id, text, sender_type, sender_user_id, sender_device_id,
            sender_name, file_path, file_name, file_size, mime_type, file_deleted,
            gif_url, gif_preview_url, read_by, delivered_to, created_at
       from chat_messages where id = $1`,
    [change.id]
  )
  if (!rows[0]) return
  const row = rows[0]
  hub.broadcast(channel, patch('upsert', {
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
    fileUrl: row.file_path && !row.file_deleted ? `/chats/messages/${row.id}/file` : null,
    gifUrl: row.gif_url,
    gifPreviewUrl: row.gif_preview_url,
    readBy: row.read_by ?? [],
    deliveredTo: row.delivered_to ?? [],
    timestamp: row.created_at ? new Date(row.created_at).toISOString() : null
  }))
}

const HANDLERS = {
  devices: dispatchDevice,
  rules: dispatchRule,
  alerts: dispatchAlert,
  commands: dispatchCommand,
  installed_apps: dispatchApp,
  screenshots: dispatchScreenshot,
  children: dispatchChild,
  chats: dispatchChat,
  chat_messages: dispatchChatMessage
}

export function startDispatcher(hub, log) {
  changes.on('change', (change) => {
    const handler = HANDLERS[change.table]
    if (!handler) return

    // A failed dispatch must not take down the listener: the next change still
    // has to get through.
    handler(hub, change).catch(err => {
      log.warn(`dispatch ${change.table}/${change.op} failed: ${err.message}`)
    })
  })

  // The listener reconnected, so changes were missed while it was down. Tell
  // every subscriber to refetch instead of leaving them with a stale view they
  // have no way to notice.
  changes.on('resync', () => {
    for (const subscriber of hub.subscribers) {
      for (const channel of subscriber.channels ?? []) {
        try {
          subscriber.send({ t: 'resync' }, channel)
        } catch { /* closing socket; its handler will clean up */ }
      }
    }
  })
}
