// Same signatures as shared/firebase/screenshots.repo.js.
//
// The download functions return a blob: URL rather than a link to the server.
// The image is authorised by the ordinary access token in a header, which an
// <img src> cannot send — and a URL carrying its own credential would end up
// in the Nginx log, in browser history, and in whatever a parent pastes into a
// chat when asking for help.

import { API_BASE_URL, API_PREFIX } from './config.js'
import { api } from './client.js'
import { realtime } from './realtime.js'
import { getAccessToken } from './tokens.js'

function byTimestampDesc(a, b) {
  return new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0)
}

export function subscribeToScreenshots(_uid, deviceId, callback) {
  if (!deviceId) return () => {}
  return realtime().subscribe(`screenshots:${deviceId}`, (shots) => {
    callback([...shots].sort(byTimestampDesc))
  })
}

// Object URLs are held until the page is unloaded unless revoked, and a parent
// scrolling through a day of screenshots would leak tens of megabytes. Kept in
// a map so a second request for the same image reuses the first one.
const objectUrls = new Map()

async function fetchAsObjectUrl(screenshotId) {
  const cached = objectUrls.get(screenshotId)
  if (cached) return cached

  const response = await fetch(`${API_BASE_URL}${API_PREFIX}/screenshots/${screenshotId}/file`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` }
  })
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'Скриншот не найден — возможно, он уже удалён.'
      : 'Не удалось загрузить скриншот.')
  }

  const url = URL.createObjectURL(await response.blob())
  objectUrls.set(screenshotId, url)
  return url
}

export async function getScreenshotDownloadURL(screenshot) {
  return fetchAsObjectUrl(screenshot.id)
}

// The panel distinguishes a preview from the full image. Here they are the
// same file: the agent already sends one JPEG at the size and quality the
// parent chose, and inventing a second, smaller copy would double the storage
// this account is charged for.
export async function getScreenshotFullDownloadURL(screenshot) {
  return fetchAsObjectUrl(screenshot.id)
}

export async function deleteScreenshot(_uid, _deviceId, screenshot) {
  await api.delete(`/screenshots/${screenshot.id}`)
  const url = objectUrls.get(screenshot.id)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrls.delete(screenshot.id)
  }
}

// Firestore tracked whether a parent had downloaded a screenshot. Nothing acts
// on it here, and recording who looked at what is a fact about a family that
// this server does not need to keep.
export async function markScreenshotDownloaded() {}

export async function recalcStorageUsed() {
  return api.post('/storage/recalculate')
}
