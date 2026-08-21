const logger = require('firebase-functions/logger')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { admin, db } = require('./firebaseAdmin')
const { REGION, requireAuth } = require('./config')

const ALLOWED_COMMAND_ACTIONS = new Set([
  'lock', 'unlock', 'screenshot_request', 'fetch_logs',
  'shutdown', 'restart', 'sleep', 'hibernate',
  'update_agent', 'force_update', 'uninstall'
])

const sendDeviceCommand = onCall({ region: REGION }, async (request) => {
  const callerUid = requireAuth(request)
  const { ownerUid: rawOwnerUid, deviceId, action, command, ...rest } = request.data || {}

  const normalizedAction = action || command
  if (!deviceId || !normalizedAction) {
    throw new HttpsError('invalid-argument', 'deviceId and action are required.')
  }
  if (!ALLOWED_COMMAND_ACTIONS.has(normalizedAction)) {
    throw new HttpsError('invalid-argument', `Unknown action: ${normalizedAction}`)
  }

  const ownerUid = rawOwnerUid || callerUid

  if (callerUid !== ownerUid) {
    const accessSnap = await db.doc(`users/${ownerUid}/parentAccess/${callerUid}`).get()
    if (!accessSnap.exists || accessSnap.data().status !== 'active') {
      throw new HttpsError('permission-denied', 'You do not have access to this device.')
    }
  }

  const deviceSnap = await db.doc(`users/${ownerUid}/devices/${deviceId}`).get()
  if (!deviceSnap.exists) throw new HttpsError('not-found', 'Device not found.')

  const device = deviceSnap.data()
  if (!device.screenshotUploadToken) throw new HttpsError('failed-precondition', 'Device is not ready (no upload token).')

  // Allowlist safe extra fields
  const extras = {}
  if (rest.message !== undefined) extras.message = String(rest.message || '').slice(0, 500)
  if (rest.requestedAtClientMs !== undefined) extras.requestedAtClientMs = Number(rest.requestedAtClientMs) || 0
  if (rest.appId !== undefined) extras.appId = String(rest.appId || '').slice(0, 100)

  const cmdRef = await db.collection(`users/${ownerUid}/devices/${deviceId}/commands`).add({
    action: normalizedAction,
    command: normalizedAction,
    ...extras,
    uploadToken: device.screenshotUploadToken,
    status: 'pending',
    timestamp: admin.firestore.Timestamp.now()
  })

  return { commandId: cmdRef.id }
})

const cleanupOldCommands = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const snap = await db.collectionGroup('commands')
    .where('status', 'in', ['completed', 'failed'])
    .where('timestamp', '<', cutoff)
    .limit(500)
    .get()

  if (snap.empty) {
    logger.info('cleanupOldCommands: nothing to clean')
    return
  }

  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  logger.info('cleanupOldCommands done', { deleted: snap.docs.length })
})

const cleanupOldActivityLogs = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const snap = await db.collectionGroup('activityLogs')
    .where('ts', '<', cutoff)
    .limit(500)
    .get()

  if (snap.empty) {
    logger.info('cleanupOldActivityLogs: nothing to clean')
    return
  }

  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  logger.info('cleanupOldActivityLogs done', { deleted: snap.docs.length })
})

module.exports = { sendDeviceCommand, cleanupOldCommands, cleanupOldActivityLogs }
