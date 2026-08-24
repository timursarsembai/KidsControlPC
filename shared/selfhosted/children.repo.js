// Профили детей. В Firebase-версии их нет — см. shared/data/children.js.

import { api } from './client.js'
import { realtime } from './realtime.js'
import { withTimestamps } from './timestamp.js'

export function subscribeToChildren(_uid, callback) {
  return realtime().subscribe('children', (children) => {
    const shaped = children.map(child => withTimestamps({ ...child }, ['createdAt', 'updatedAt']))
    // Порядок создания: список детей не должен переставляться сам по себе,
    // когда родитель что-то поправил в профиле.
    callback(shaped.sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0)))
  })
}

export async function createChild(_uid, { name, avatar, note } = {}) {
  const child = await api.post('/children', { name, avatar, note })
  return child.id
}

export async function updateChild(_uid, childId, updates) {
  await api.patch(`/children/${childId}`, updates)
}

export async function deleteChild(_uid, childId) {
  await api.delete(`/children/${childId}`)
}

// Устройство переезжает к другому ребёнку — или ни к кому, если childId пуст.
export async function assignDevice(_uid, deviceId, childId) {
  await api.patch(`/devices/${deviceId}`, { childId: childId ?? null })
}
