const logger = require('firebase-functions/logger')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onObjectFinalized, onObjectDeleted } = require('firebase-functions/v2/storage')
const { admin, db } = require('./firebaseAdmin')
const { STORAGE_REGION, REGION } = require('./config')

const ATTACHMENT_RE = /^users\/([^/]+)\/chats\/([^/]+)\/attachments\/(.+)$/
const SCREENSHOT_RE = /^users\/([^/]+)\/devices\/([^/]+)\/screenshots\/(.+)$/
const FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000   // 7 дней
const DEFAULT_QUOTA = 100 * 1024 * 1024             // 100 МБ (Free план)
const PURGE_THRESHOLD = 0.9                         // 90% — начать принудительную очистку
const PURGE_TARGET = 0.7                            // освободить до 70% заполненности

function profileRef(ownerUid) {
  return db.collection('users').doc(ownerUid).collection('profile').doc('data')
}

async function markMessageFileDeleted(ownerUid, chatId, storagePath) {
  try {
    const snap = await db
      .collection('users').doc(ownerUid)
      .collection('chats').doc(chatId)
      .collection('messages')
      .where('storagePath', '==', storagePath)
      .limit(1)
      .get()
    if (!snap.empty) {
      await snap.docs[0].ref.update({ fileDeleted: true })
    }
  } catch (e) {
    logger.warn('markMessageFileDeleted error', { ownerUid, chatId, storagePath, error: e.message })
  }
}

// Delete oldest attachment files for an owner until usage drops to PURGE_TARGET.
async function purgeOldestFiles(ownerUid, usedBytes, quotaBytes) {
  const bucket = admin.storage().bucket()
  const [files] = await bucket.getFiles({ prefix: `users/${ownerUid}/chats/` })
  const attachments = files
    .filter(f => ATTACHMENT_RE.test(f.name))
    .sort((a, b) => new Date(a.metadata.timeCreated) - new Date(b.metadata.timeCreated))

  const targetBytes = quotaBytes * PURGE_TARGET
  let freed = 0
  for (const file of attachments) {
    if (usedBytes - freed <= targetBytes) break
    const size = Number(file.metadata.size || 0)
    const match = file.name.match(ATTACHMENT_RE)
    if (match) {
      const [, uid, chatId] = match
      await file.delete().catch(() => {})
      await markMessageFileDeleted(uid, chatId, file.name)
      freed += size
      logger.info('purgeOldestFiles deleted', { file: file.name, size })
    }
  }
}

const onChatFileUploaded = onObjectFinalized({ region: STORAGE_REGION }, async (event) => {
  const objectName = event.data.name
  const attachMatch = objectName?.match(ATTACHMENT_RE)
  const ssMatch = objectName?.match(SCREENSHOT_RE)
  if (!attachMatch && !ssMatch) return

  const ownerUid = (attachMatch || ssMatch)[1]
  const size = Number(event.data.size || 0)
  const ref = profileRef(ownerUid)

  await ref.set(
    { storageUsedBytes: admin.firestore.FieldValue.increment(size) },
    { merge: true }
  )

  const snap = await ref.get()
  const data = snap.data() || {}
  const used = data.storageUsedBytes || 0
  const quota = data.storageQuotaBytes || DEFAULT_QUOTA

  if (used / quota >= PURGE_THRESHOLD) {
    logger.info('onChatFileUploaded: quota threshold exceeded, purging', { ownerUid, used, quota })
    await purgeOldestFiles(ownerUid, used, quota)
  }
})

const onChatFileDeleted = onObjectDeleted({ region: STORAGE_REGION }, async (event) => {
  const objectName = event.data.name
  const attachMatch = objectName?.match(ATTACHMENT_RE)
  const ssMatch = objectName?.match(SCREENSHOT_RE)
  if (!attachMatch && !ssMatch) return

  const ownerUid = (attachMatch || ssMatch)[1]
  const size = Number(event.data.size || 0)
  const ref = profileRef(ownerUid)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.data()?.storageUsedBytes || 0
    tx.set(ref, { storageUsedBytes: Math.max(0, current - size) }, { merge: true })
  })

  if (attachMatch) {
    await markMessageFileDeleted(ownerUid, attachMatch[2], objectName)
  }
})

// Scheduled cleanup: delete attachments older than 7 days for all users.
const cleanupOldChatFiles = onSchedule({ region: REGION, schedule: 'every 24 hours' }, async () => {
  const bucket = admin.storage().bucket()
  const cutoff = Date.now() - FILE_MAX_AGE_MS
  const [files] = await bucket.getFiles({ prefix: 'users/' })

  for (const file of files) {
    if (!ATTACHMENT_RE.test(file.name)) continue
    const created = new Date(file.metadata.timeCreated).getTime()
    if (created > cutoff) continue

    const match = file.name.match(ATTACHMENT_RE)
    if (!match) continue
    const [, ownerUid, chatId] = match

    logger.info('cleanupOldChatFiles deleting', { file: file.name })
    await file.delete().catch(() => {})
    await markMessageFileDeleted(ownerUid, chatId, file.name)
  }
})

// Hourly recalculation of storageUsedBytes from real Storage contents.
const recalcStorageUsed = onSchedule({ region: REGION, schedule: 'every 60 minutes' }, async () => {
  const bucket = admin.storage().bucket()
  const [files] = await bucket.getFiles({ prefix: 'users/' })

  const totals = {}
  for (const file of files) {
    const m = file.name.match(ATTACHMENT_RE) || file.name.match(SCREENSHOT_RE)
    if (!m) continue
    const uid = m[1]
    const size = Number(file.metadata.size || 0)
    totals[uid] = (totals[uid] || 0) + size
  }

  for (const [uid, bytes] of Object.entries(totals)) {
    await profileRef(uid).set({ storageUsedBytes: bytes }, { merge: true })
  }

  // Zero out users with no files but a non-zero counter
  // (files deleted outside of triggers). Skip — expensive, not worth it.
  logger.info('recalcStorageUsed done', { users: Object.keys(totals).length })
})

module.exports = {
  onChatFileUploaded,
  onChatFileDeleted,
  cleanupOldChatFiles,
  recalcStorageUsed
}
