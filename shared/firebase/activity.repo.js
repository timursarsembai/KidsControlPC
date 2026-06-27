import {
  collection, doc, query, where, orderBy, limit,
  onSnapshot, getDocs, Timestamp
} from 'firebase/firestore'
import { db } from './config.js'

function activityLogsRef(ownerUid, deviceId) {
  return collection(db, 'users', ownerUid, 'devices', deviceId, 'activityLogs')
}

function activityStatsRef(ownerUid, deviceId) {
  return collection(db, 'users', ownerUid, 'devices', deviceId, 'activityStats')
}

/**
 * Subscribe to activity log events for a given device.
 * Filtered to today by default; pass a Date for a specific day.
 * Returns unsubscribe function.
 */
export function subscribeToActivityLogs(ownerUid, deviceId, date, callback) {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  const q = query(
    activityLogsRef(ownerUid, deviceId),
    where('ts', '>=', Timestamp.fromDate(startOfDay)),
    where('ts', '<=', Timestamp.fromDate(endOfDay)),
    orderBy('ts', 'desc'),
    limit(500)
  )

  return onSnapshot(q, (snap) => {
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    callback(logs)
  }, () => callback([]))
}

/**
 * Fetch activityStats docs for the last N days.
 * Returns array of stat objects sorted newest first.
 */
export async function getActivityStats(ownerUid, deviceId, days = 7) {
  const dates = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  const snap = await getDocs(
    query(activityStatsRef(ownerUid, deviceId), where('date', 'in', dates))
  )
  return snap.docs
    .map(d => d.data())
    .sort((a, b) => (b.date > a.date ? 1 : -1))
}

/**
 * Subscribe to activityStats for real-time updates.
 * Calls callback with array of stat docs for the last 7 days.
 */
export function subscribeToActivityStats(ownerUid, deviceId, days = 7, callback) {
  const dates = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  const q = query(
    activityStatsRef(ownerUid, deviceId),
    where('date', 'in', dates)
  )

  return onSnapshot(q, (snap) => {
    const stats = snap.docs
      .map(d => d.data())
      .sort((a, b) => (b.date > a.date ? 1 : -1))
    callback(stats)
  }, () => callback([]))
}
