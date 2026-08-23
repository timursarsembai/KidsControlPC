// Turns "row X changed" notifications into messages for whoever is watching.
//
// The row is read from the database here rather than carried in the trigger
// payload, so every subscriber gets the committed state and the same shape the
// REST routes produce.

import { query } from '../db.js'
import { DEVICE_COLUMNS, RULE_COLUMNS, serializeDevice, serializeRule } from '../serializers.js'
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

export function startDispatcher(hub, log) {
  changes.on('change', (change) => {
    const handler = change.table === 'devices' ? dispatchDevice
      : change.table === 'rules' ? dispatchRule
        : null
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
