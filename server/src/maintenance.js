// Periodic housekeeping. Replaces the Cloud Functions that ran onSchedule.
//
// Everything here is safe to run twice and safe to skip: if a pass fails, the
// next one picks up the same rows. Nothing in it is allowed to throw out to
// the caller — a failed cleanup must never look like a failed service.

import { query } from './db.js'
import { pruneRefreshTokens } from './auth/tokens.js'

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

export async function runMaintenance(log) {
  const tasks = [
    ['refresh tokens', pruneRefreshTokens],
    ['pairing codes', pruneExpiredPairingCodes],
    ['commands', pruneOldCommands],
    ['alerts', pruneOldAlerts],
    ['email tokens', pruneEmailTokens]
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
