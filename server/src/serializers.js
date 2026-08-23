// Row → API shape. Kept in one place because both the REST routes and the
// WebSocket push have to produce identical objects: a panel that receives a
// device one way on load and another way on update would need two code paths
// to read the same thing.

// The agent sends a heartbeat every 30 seconds. Six missed beats before a
// device is called offline: a Windows 11 machine coming back from Modern
// Standby needs tens of seconds to get its network back, and a card that
// flickers between online and offline is worse than one that lags.
const OFFLINE_AFTER_MS = 3 * 60 * 1000

export const DEVICE_COLUMNS = `id, hostname, os_type, device_name, alias, agent_version,
                               status, last_seen, paired_at, settings, pomodoro_state`

export function serializeDevice(row, { includeLogs = false } = {}) {
  const lastSeen = row.last_seen ? new Date(row.last_seen) : null

  // A stored status of 'online' only means the agent said so once. If it then
  // lost power or was killed, nothing ever writes 'offline' — so the age of
  // the last heartbeat is what actually decides.
  const stale = !lastSeen || Date.now() - lastSeen.getTime() > OFFLINE_AFTER_MS
  const status = row.status === 'online' && stale ? 'offline' : row.status

  const device = {
    id: row.id,
    hostname: row.hostname,
    osType: row.os_type,
    deviceName: row.device_name,
    alias: row.alias,
    agentVersion: row.agent_version,
    status,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
    pairedAt: row.paired_at ? new Date(row.paired_at).toISOString() : null,
    settings: row.settings ?? {},
    pomodoroState: row.pomodoro_state ?? null
  }
  // recentLogs is up to a hundred lines per device — fine when a parent opens
  // one device to diagnose it, wasteful on every list request.
  if (includeLogs) device.recentLogs = row.recent_logs ?? []
  return device
}

export const RULE_COLUMNS = 'id, device_id, slug, status, payload, created_at, updated_at'

// The rule's own fields are spread at the top level, the way the Firestore
// documents looked: the agent's rule evaluator reads them directly, and
// nesting them under `payload` would mean touching every consumer.
export function serializeRule(row) {
  return {
    ...(row.payload ?? {}),
    id: row.id,
    deviceId: row.device_id,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  }
}
