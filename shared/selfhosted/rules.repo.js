// Same signatures as shared/firebase/rules.repo.js.

import { api } from './client.js'
import { realtime } from './realtime.js'
import { withTimestamps } from './timestamp.js'

const POMODORO_SLUG = 'global_pomodoro'

// Firestore ordered by createdAt desc. Sorting here rather than trusting the
// socket: a snapshot arrives ordered, but an upsert lands wherever the entry
// already sat, so a newly created rule would otherwise appear at the bottom
// of the list instead of the top.
function byCreatedAtDesc(a, b) {
  return new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)
}

export function subscribeToRules(_uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return realtime().subscribe(`rules:${deviceId}`, (rules) => {
    const shaped = rules.map(rule => withTimestamps({ ...rule }, ['createdAt', 'updatedAt']))
    callback(shaped.sort(byCreatedAtDesc))
  })
}

export async function addRule(_uid, deviceId, ruleData) {
  const rule = await api.post(`/devices/${deviceId}/rules`, ruleData)
  return rule.id
}

export async function updateRule(_uid, deviceId, ruleId, updates) {
  await api.patch(`/devices/${deviceId}/rules/${ruleId}`, updates)
}

// Fixed-id rule: the panel just saves, and whether a row exists is the
// server's problem.
export async function savePomodoroRule(_uid, deviceId, data) {
  await api.put(`/devices/${deviceId}/rules/slug/${POMODORO_SLUG}`, data)
}

export async function deleteRule(_uid, deviceId, ruleId) {
  await api.delete(`/devices/${deviceId}/rules/${ruleId}`)
}
