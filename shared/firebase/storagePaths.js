// Single source of truth for Firebase Storage object-path parsing.
// Mirrors the regexes used by Cloud Functions so quota counting, cleanup
// and the Storage UI all agree on what a path means.

export const ATTACHMENT_RE = /^users\/([^/]+)\/chats\/([^/]+)\/attachments\/(.+)$/
export const SCREENSHOT_RE = /^users\/([^/]+)\/devices\/([^/]+)\/screenshots\/(.+)$/

// Returns { type, ownerUid, contextId, fileName } or null if the path is not
// a counted user file (attachment or screenshot).
export function classifyStoragePath(fullPath) {
  if (!fullPath) return null

  const a = fullPath.match(ATTACHMENT_RE)
  if (a) return { type: 'attachment', ownerUid: a[1], contextId: a[2], fileName: a[3] }

  const s = fullPath.match(SCREENSHOT_RE)
  if (s) return { type: 'screenshot', ownerUid: s[1], contextId: s[2], fileName: s[3] }

  return null
}

// Whether this object counts toward the owner's storage quota.
export function isCountedFile(fullPath) {
  return classifyStoragePath(fullPath) !== null
}

// Short human-readable context label for the Storage table.
export function storageContextLabel(fullPath) {
  const info = classifyStoragePath(fullPath)
  if (!info) return '—'
  const short = info.contextId.length > 8 ? info.contextId.slice(0, 8) + '…' : info.contextId
  return info.type === 'attachment' ? 'Чат: ' + short : 'Устройство: ' + short
}
