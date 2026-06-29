import { sendDeviceCommand as fsSendDeviceCommand } from '../../firebase/commands.repo.js'
import {
  deleteScreenshot as fsDeleteScreenshot,
  getScreenshotDownloadURL as fsGetScreenshotDownloadURL,
  getScreenshotFullDownloadURL as fsGetScreenshotFullDownloadURL,
  markScreenshotDownloaded as fsMarkScreenshotDownloaded
} from '../../firebase/screenshots.repo.js'
import { logger } from '../../utils/logger.js'

export const createScreenshotsSlice = (set, get) => ({
  screenshots: [],

  requestScreenshot: async () => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    const ownerUid = activeOwnerUid || user.uid
    logger.info(selectedDeviceId, 'Запрос скриншота экрана')
    await fsSendDeviceCommand(ownerUid, selectedDeviceId, {
      command: 'screenshot_request',
      requestedAtClientMs: Date.now()
    })
  },

  deleteScreenshot: async (screenshot) => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const ownerUid = activeOwnerUid || user.uid
    await fsDeleteScreenshot(ownerUid, selectedDeviceId, screenshot)
  },

  markScreenshotDownloaded: async (screenshotId) => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const ownerUid = activeOwnerUid || user.uid
    await fsMarkScreenshotDownloaded(ownerUid, selectedDeviceId, screenshotId)
  },

  getScreenshotDownloadURL: async (screenshot) => {
    return await fsGetScreenshotDownloadURL(screenshot)
  },

  getScreenshotFullDownloadURL: async (screenshot) => {
    return await fsGetScreenshotFullDownloadURL(screenshot)
  }
})
