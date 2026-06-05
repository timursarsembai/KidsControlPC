import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { collection, addDoc, serverTimestamp, query, where, getDocs, deleteDoc, limit, updateDoc, doc } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes, deleteObject } from 'firebase/storage'
import { db } from '../network/firebaseSync.js'
import { PAIRING_FILE } from '../config.js'
import { getDeviceConfig } from '../core/configManager.js'
import { delay, execAsync, runEncodedPS } from '../core/utils.js'
import { getScheduleGroups, isScheduleGroupActive } from '../ruleTiming.js'

const MIN_SCREENSHOT_INTERVAL_MS = 60 * 1000
const SCHEDULE_CHECK_INTERVAL_MS = 30 * 1000
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const SCREENSHOT_TTL_MS = 60 * 60 * 1000
const INLINE_SCREENSHOT_MAX_BYTES = 900 * 1024
const DEFAULT_QUALITY = 70
const DEFAULT_MAX_WIDTH = 1280

let parentUid = null
let deviceId = null
let lastManualScreenshotAt = 0
let lastScheduledScreenshotAt = 0
let lastCleanupAt = 0
let scheduledTimer = null
let captureInProgress = false
let uploadToken = null

function log(msg) {
  console.log(`[Screenshot] ${msg}`)
}

function getScreenshotHelperPath() {
  return process.env.NODE_ENV === 'development'
    ? path.join(process.cwd(), 'dist', 'ScreenshotHelper.exe')
    : path.join(process.cwd(), 'ScreenshotHelper.exe')
}

function normalizeNumber(value, fallback, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function getScreenshotSettings() {
  const config = getDeviceConfig()
  return config?.screenshots || config?.screenshotSettings || {}
}

function readPairingFile() {
  try {
    if (!fs.existsSync(PAIRING_FILE)) return null
    return JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf8'))
  } catch {
    return null
  }
}

function writePairingFile(pairing) {
  fs.writeFileSync(PAIRING_FILE, JSON.stringify(pairing, null, 2), 'utf8')
}

async function ensureUploadToken() {
  if (uploadToken) return uploadToken

  const pairing = readPairingFile() || {}
  uploadToken = pairing.screenshotUploadToken
  if (!uploadToken) {
    uploadToken = randomBytes(32).toString('hex')
    writePairingFile({ ...pairing, screenshotUploadToken: uploadToken })
  }

  await updateDoc(doc(db, 'users', parentUid, 'devices', deviceId), {
    screenshotUploadToken: uploadToken
  })

  return uploadToken
}

function isScheduleActive(schedule, now = new Date()) {
  return getScheduleGroups(schedule).some(group => isScheduleGroupActive(group, now))
}

async function launchHelperInUserSession(helperPath, outputPath, maxWidth, quality) {
  if (!fs.existsSync(helperPath)) {
    throw new Error(`ScreenshotHelper not found: ${helperPath}`)
  }

  if (!process.argv.includes('--service')) {
    await execAsync(`"${helperPath}" "${outputPath}" ${maxWidth} ${quality}`, {
      timeout: 30000,
      windowsHide: true
    })
    return
  }

  const taskName = `KCScreenshot_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  const escapedHelper = helperPath.replace(/'/g, "''")
  const escapedOutput = outputPath.replace(/'/g, "''")
  const psLines = [
    "$explorer = Get-CimInstance Win32_Process -Filter \"Name = 'explorer.exe'\" -EA SilentlyContinue | Select -First 1",
    'if (-not $explorer) { throw "No active explorer.exe session found" }',
    '$owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner',
    '$userId = "$($owner.Domain)\\$($owner.User)"',
    `$action = New-ScheduledTaskAction -Execute '${escapedHelper}' -Argument '"${escapedOutput}" ${maxWidth} ${quality}'`,
    '$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 45)',
    `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${taskName}'`,
    '$deadline = (Get-Date).AddSeconds(30)',
    `while ((Get-Date) -lt $deadline -and -not (Test-Path '${escapedOutput}')) { Start-Sleep -Milliseconds 500 }`,
    `Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -EA SilentlyContinue`,
    `if (-not (Test-Path '${escapedOutput}')) { throw "Screenshot helper did not produce output" }`
  ]
  await runEncodedPS(psLines.join('\n'), 45000)
}

async function captureScreenshotFile(settings) {
  const requestId = randomUUID()
  const outputDir = path.join(os.tmpdir(), 'kidscontrol-screenshots')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${requestId}.jpg`)
  const helperPath = getScreenshotHelperPath()
  const maxWidth = normalizeNumber(settings.maxWidth, DEFAULT_MAX_WIDTH, 320, 3840)
  const quality = normalizeNumber(settings.quality, DEFAULT_QUALITY, 20, 95)

  await launchHelperInUserSession(helperPath, outputPath, maxWidth, quality)
  const stats = fs.statSync(outputPath)
  if (stats.size <= 0) throw new Error('Screenshot file is empty')

  return { requestId, outputPath, maxWidth, quality, size: stats.size }
}

async function saveScreenshotDoc(fileInfo, source, token, extra = {}) {
  const screenshotsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'screenshots')
  const docRef = await addDoc(screenshotsRef, {
    source,
    status: 'ready',
    uploadToken: token,
    size: fileInfo.size,
    quality: fileInfo.quality,
    maxWidth: fileInfo.maxWidth,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + SCREENSHOT_TTL_MS),
    ...extra
  })

  return { screenshotId: docRef.id, ...extra }
}

async function uploadScreenshotToStorage(fileInfo, source, token) {
  const storage = getStorage()
  const storagePath = `users/${parentUid}/devices/${deviceId}/screenshots/${fileInfo.requestId}.jpg`
  const ref = storageRef(storage, storagePath)
  const bytes = fs.readFileSync(fileInfo.outputPath)

  await uploadBytes(ref, bytes, {
    contentType: 'image/jpeg',
    customMetadata: {
      source,
      deviceId,
      requestId: fileInfo.requestId,
      uploadToken: token
    }
  })

  return await saveScreenshotDoc(fileInfo, source, token, {
    storagePath,
    delivery: 'storage'
  })
}

async function saveInlineScreenshot(fileInfo, source, token) {
  if (fileInfo.size > INLINE_SCREENSHOT_MAX_BYTES) {
    throw new Error(`Screenshot is too large for inline fallback: ${fileInfo.size} bytes`)
  }

  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(fileInfo.outputPath).toString('base64')}`
  return await saveScreenshotDoc(fileInfo, source, token, {
    dataUrl,
    delivery: 'firestore_inline'
  })
}

async function uploadScreenshot(fileInfo, source) {
  const token = await ensureUploadToken()
  try {
    return await uploadScreenshotToStorage(fileInfo, source, token)
  } catch (err) {
    log(`Storage upload failed, using inline fallback: ${err.message}`)
    return await saveInlineScreenshot(fileInfo, source, token)
  }
}

async function cleanupExpiredScreenshots() {
  if (!parentUid || !deviceId) return
  const now = Date.now()
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now

  const screenshotsRef = collection(db, 'users', parentUid, 'devices', deviceId, 'screenshots')
  const expiredQuery = query(screenshotsRef, where('expiresAt', '<=', new Date()), limit(20))
  const snap = await getDocs(expiredQuery)
  const storage = getStorage()

  for (const docSnap of snap.docs) {
    const data = docSnap.data()
    if (data.storagePath) {
      try {
        await deleteObject(storageRef(storage, data.storagePath))
      } catch {}
    }
    await deleteDoc(docSnap.ref)
  }

  if (!snap.empty) log(`Cleaned up ${snap.size} expired screenshots`)
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
    fileInfo = await captureScreenshotFile(settings)
    const result = await uploadScreenshot(fileInfo, source)
    if (source === 'manual') lastManualScreenshotAt = now
    else lastScheduledScreenshotAt = now
    log(`Uploaded ${source} screenshot: ${result.screenshotId}`)
    return result
  } finally {
    captureInProgress = false
    if (fileInfo?.outputPath) {
      try { fs.unlinkSync(fileInfo.outputPath) } catch {}
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
  ensureUploadToken().catch(err => log(`Upload token setup failed: ${err.message}`))
  if (scheduledTimer) clearInterval(scheduledTimer)
  scheduledTimer = setInterval(() => {
    cleanupExpiredScreenshots().catch(err => log(`Screenshot cleanup failed: ${err.message}`))
    maybeTakeScheduledScreenshot().catch(err => log(`Schedule check failed: ${err.message}`))
  }, SCHEDULE_CHECK_INTERVAL_MS)
  log('Screenshot service started')
}

export function stopScreenshotService() {
  if (scheduledTimer) clearInterval(scheduledTimer)
  scheduledTimer = null
}
