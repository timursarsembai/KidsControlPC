import fs from 'fs'
import { getDeviceConfig } from '../core/configManager.js'
import { getScheduleGroups, isScheduleGroupActive } from '../ruleTiming.js'
import { captureScreenshotFile, normalizeNumber } from './screenshotCapture.js'
import {
  cleanupExpiredScreenshots,
  ensureUploadToken,
  uploadScreenshot
} from './screenshotUpload.js'
import { withOperationTimeout } from './operationTimeout.js'

const MIN_SCREENSHOT_INTERVAL_MS = 60 * 1000
const SCHEDULE_CHECK_INTERVAL_MS = 30 * 1000
const CAPTURE_OPERATION_TIMEOUT_MS = 65 * 1000
const UPLOAD_OPERATION_TIMEOUT_MS = 65 * 1000

let parentUid = null
let deviceId = null
let lastManualScreenshotAt = 0
let lastScheduledScreenshotAt = 0
let scheduledTimer = null
let captureInProgress = false

function log(msg) {
  console.log(`[Screenshot] ${msg}`)
}

function getScreenshotSettings() {
  const config = getDeviceConfig()
  return config?.screenshots || config?.screenshotSettings || {}
}

function isScheduleActive(schedule, now = new Date()) {
  return getScheduleGroups(schedule).some(group => isScheduleGroupActive(group, now))
}

export async function takeScreenshot(source = 'manual') {
  if (!parentUid || !deviceId) throw new Error('Screenshot service is not initialized')
  if (captureInProgress) throw new Error('Screenshot capture already in progress')

  const now = Date.now()
  const lastAt = source === 'manual' ? lastManualScreenshotAt : lastScheduledScreenshotAt
  if (now - lastAt < MIN_SCREENSHOT_INTERVAL_MS) {
    const waitSeconds = Math.ceil((MIN_SCREENSHOT_INTERVAL_MS - (now - lastAt)) / 1000)
    const err = new Error(`Rate limited. Try again in ${waitSeconds}s`)
    err.code = 'rate_limited'
    throw err
  }

  captureInProgress = true
  const settings = getScreenshotSettings()
  let fileInfo = null
  try {
    log(`Starting ${source} screenshot capture`)
    fileInfo = await withOperationTimeout(
      captureScreenshotFile(settings),
      CAPTURE_OPERATION_TIMEOUT_MS,
      `${source} screenshot capture timed out after ${CAPTURE_OPERATION_TIMEOUT_MS / 1000}s`,
      'screenshot_capture_timeout'
    )
    log(`Captured ${source} screenshot: ${fileInfo.size} bytes`)

    log(`Uploading ${source} screenshot`)
    const result = await withOperationTimeout(
      uploadScreenshot(fileInfo, source, parentUid, deviceId, log),
      UPLOAD_OPERATION_TIMEOUT_MS,
      `${source} screenshot upload timed out after ${UPLOAD_OPERATION_TIMEOUT_MS / 1000}s`,
      'screenshot_upload_timeout'
    )
    if (source === 'manual') lastManualScreenshotAt = now
    else lastScheduledScreenshotAt = now
    log(`Uploaded ${source} screenshot: ${result.screenshotId}`)
    return result
  } finally {
    captureInProgress = false
    if (fileInfo?.outputPath) {
      try { fs.unlinkSync(fileInfo.outputPath) } catch {}
      try { fs.unlinkSync(`${fileInfo.outputPath}.error.txt`) } catch {}
    }
  }
}

async function maybeTakeScheduledScreenshot() {
  const settings = getScreenshotSettings()
  if (!settings.enabled) return
  const intervalMinutes = normalizeNumber(settings.intervalMinutes, 1, 1, 1440)
  if (Date.now() - lastScheduledScreenshotAt < intervalMinutes * 60 * 1000) return
  if (!isScheduleActive(settings.schedule, new Date())) return

  try {
    await takeScreenshot('scheduled')
  } catch (err) {
    if (err.code !== 'rate_limited') log(`Scheduled screenshot failed: ${err.message}`)
  }
}

export function startScreenshotService(pUid, dId) {
  parentUid = pUid
  deviceId = dId
  ensureUploadToken(parentUid, deviceId).catch(err => log(`Upload token setup failed: ${err.message}`))
  if (scheduledTimer) clearInterval(scheduledTimer)
  scheduledTimer = setInterval(() => {
    cleanupExpiredScreenshots(parentUid, deviceId, log).catch(err => log(`Screenshot cleanup failed: ${err.message}`))
    maybeTakeScheduledScreenshot().catch(err => log(`Schedule check failed: ${err.message}`))
  }, SCHEDULE_CHECK_INTERVAL_MS)
  log('Screenshot service started')
}

export function stopScreenshotService() {
  if (scheduledTimer) clearInterval(scheduledTimer)
  scheduledTimer = null
}
