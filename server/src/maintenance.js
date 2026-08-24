// Periodic housekeeping. Replaces the Cloud Functions that ran onSchedule.
//
// Everything here is safe to run twice and safe to skip: if a pass fails, the
// next one picks up the same rows. Nothing in it is allowed to throw out to
// the caller — a failed cleanup must never look like a failed service.

import { query } from './db.js'
import { pruneRefreshTokens } from './auth/tokens.js'
import { deleteFile, listStoredFiles } from './storage/files.js'

// Used codes are kept for a day: when a parent reports "pairing did not work",
// the row is the only evidence of whether the code was ever redeemed.
async function pruneExpiredPairingCodes() {
  const { rowCount } = await query(
    `delete from pairing_codes
      where (used = false and expires_at < now() - interval '1 hour')
         or (used = true  and used_at   < now() - interval '1 day')`
  )
  return rowCount
}

// Replaces the cleanupOldCommands scheduled function: finished commands are
// kept a week, which is long enough to answer "did that lock actually reach
// the PC" and short enough not to grow forever.
async function pruneOldCommands() {
  const { rowCount } = await query(
    `delete from commands
      where status <> 'pending' and created_at < now() - interval '7 days'`
  )
  return rowCount
}

// Acknowledged alerts are history the parent has already seen. Unacknowledged
// ones are kept regardless of age: an alert nobody looked at is exactly the
// one that should still be there.
async function pruneOldAlerts() {
  const { rowCount } = await query(
    `delete from alerts
      where acknowledged = true and created_at < now() - interval '30 days'`
  )
  return rowCount
}

// A spent recovery link is kept a day: when a parent says "я нажал, и ничего",
// the row is the only evidence of whether the link was ever opened.
async function pruneEmailTokens() {
  const { rowCount } = await query(
    `delete from email_tokens
      where expires_at < now() - interval '1 day'
         or (used_at is not null and used_at < now() - interval '1 day')`
  )
  return rowCount
}

// Otherwise an invitation nobody answered stays "ожидает ответа" in the
// owner's list forever, and the unique index keeps blocking a new one to the
// same address.
async function expireParentInvitations() {
  const { rowCount } = await query(
    `update parent_invitations
        set status = 'expired', responded_at = now()
      where status = 'pending' and expires_at < now()`
  )
  return rowCount
}

/**
 * Expired screenshots: rows, files and the quota they counted against.
 *
 * Deleted in batches so one pass cannot hold a transaction open over thousands
 * of files, and the file is removed after the row: a crash in between leaves an
 * orphaned file, which /storage/recalculate cleans up in its accounting — the
 * other order would leave a row pointing at nothing, which the panel shows as
 * a broken image.
 */
async function pruneExpiredScreenshots(log) {
  const { rows } = await query(
    `delete from screenshots
      where id in (select id from screenshots where expires_at < now() limit 500)
      returning path, size_bytes, owner_id`
  )
  if (rows.length === 0) return 0

  const freedByOwner = new Map()
  for (const row of rows) {
    freedByOwner.set(row.owner_id, (freedByOwner.get(row.owner_id) ?? 0) + Number(row.size_bytes))
  }
  for (const [ownerId, freed] of freedByOwner) {
    await query(
      `update profiles
          set storage_used_bytes = greatest(0, storage_used_bytes - $2), updated_at = now()
        where user_id = $1`,
      [ownerId, freed]
    )
  }
  for (const row of rows) {
    await deleteFile(row.path).catch(err => log?.warn(`could not delete ${row.path}: ${err.message}`))
  }
  return rows.length
}

/**
 * Files on disk that no row points at.
 *
 * Happens when an account is removed by a cascade nothing in the code saw — a
 * user deleted straight from psql, a restore from an older dump — or when an
 * upload was interrupted between writing the file and inserting the row.
 * Nobody can see these, nothing counts them, and they never go away by
 * themselves.
 *
 * Only files older than a day are considered, so an upload in flight right now
 * is never mistaken for rubbish.
 */
async function sweepOrphanFiles(log) {
  const files = await listStoredFiles()
  if (files.length === 0) return 0

  // Every table that owns a file has to be listed here. Miss one and the
  // sweep deletes its files a day later, quietly and for good — chat
  // attachments were exactly one such near miss.
  const { rows } = await query(
    `select path from screenshots
     union all
     select file_path as path from chat_messages where file_path is not null`
  )
  const known = new Set(rows.map(row => row.path))

  const { stat } = await import('node:fs/promises')
  const { resolveStoredPath } = await import('./storage/files.js')
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000

  let removed = 0
  for (const file of files) {
    if (known.has(file)) continue
    try {
      const info = await stat(resolveStoredPath(file))
      if (info.mtimeMs > dayAgo) continue
    } catch {
      continue
    }
    await deleteFile(file).catch(err => log?.warn(`orphan ${file}: ${err.message}`))
    removed++
  }
  return removed
}

export async function runMaintenance(log) {
  const tasks = [
    ['refresh tokens', pruneRefreshTokens],
    ['pairing codes', pruneExpiredPairingCodes],
    ['commands', pruneOldCommands],
    ['alerts', pruneOldAlerts],
    ['email tokens', pruneEmailTokens],
    ['parent invitations', expireParentInvitations],
    ['screenshots', () => pruneExpiredScreenshots(log)],
    ['orphan files', () => sweepOrphanFiles(log)]
  ]

  for (const [name, task] of tasks) {
    try {
      const removed = await task()
      if (removed > 0) log.info(`maintenance: removed ${removed} stale ${name}`)
    } catch (err) {
      log.warn(`maintenance: ${name} cleanup failed: ${err.message}`)
    }
  }
}
