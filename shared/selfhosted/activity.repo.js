// Same signatures as shared/firebase/activity.repo.js.
//
// There is no live channel for activity: the agent reports in batches every
// fifteen seconds or so, and a socket per open panel would push a stream of
// updates nobody watches that closely. The panel polls instead, and stops the
// moment the screen is closed.

import { api } from './client.js'
import { timestamp } from './timestamp.js'

const POLL_INTERVAL_MS = 30_000

function localDate(date = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Poll helper: fetches now, then on an interval, until cancelled.
 *
 * A failed fetch keeps the previous result on screen rather than blanking it —
 * a dropped connection should not read as "the child did nothing today".
 */
function poll(fetchOnce, callback) {
  let cancelled = false

  const tick = async () => {
    try {
      const value = await fetchOnce()
      if (!cancelled) callback(value)
    } catch {
      // Keep whatever is already shown.
    }
  }

  tick()
  const timer = setInterval(tick, POLL_INTERVAL_MS)

  return () => {
    cancelled = true
    clearInterval(timer)
  }
}

/**
 * Events for one day.
 *
 * The day is the parent's day, not the server's: the offset goes with the
 * request, so an evening in Almaty stays that evening even though the server
 * keeps time in UTC.
 */
export function subscribeToActivityLogs(_ownerUid, deviceId, date, callback) {
  if (!deviceId) return () => {}

  const day = localDate(date ?? new Date())
  const tzOffsetMinutes = -new Date().getTimezoneOffset()

  return poll(
    async () => {
      const result = await api.get(
        `/devices/${deviceId}/activity/logs?date=${day}&tzOffsetMinutes=${tzOffsetMinutes}`
      )
      // ts becomes a Firestore-shaped value: the panel reads it with
      // `log.ts?.toDate?.()`, in ten different places.
      return (result.logs ?? []).map(log => ({ ...log, ts: timestamp(log.ts) }))
    },
    callback
  )
}

export async function getActivityStats(_ownerUid, deviceId, days = 7) {
  if (!deviceId) return []
  const result = await api.get(`/devices/${deviceId}/activity/stats?days=${days}`)
  return result.stats ?? []
}

export function subscribeToActivityStats(_ownerUid, deviceId, days = 7, callback) {
  if (!deviceId) return () => {}
  return poll(() => getActivityStats(null, deviceId, days), callback)
}

export function subscribeToActivityStatsRange(_ownerUid, deviceId, startDateStr, endDateStr, callback) {
  if (!deviceId) return () => {}
  return poll(
    async () => {
      const result = await api.get(
        `/devices/${deviceId}/activity/stats?from=${startDateStr}&to=${endDateStr}`
      )
      return result.stats ?? []
    },
    callback
  )
}
