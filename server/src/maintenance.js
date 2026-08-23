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

export async function runMaintenance(log) {
  const tasks = [
    ['refresh tokens', pruneRefreshTokens],
    ['pairing codes', pruneExpiredPairingCodes]
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
