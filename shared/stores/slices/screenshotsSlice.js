import { sendDeviceCommand as fsSendDeviceCommand } from '../../firebase/commands.repo.js'
import {
  deleteScreenshot as fsDeleteScreenshot,
  getScreenshotDownloadURL as fsGetScreenshotDownloadURL
} from '../../firebase/screenshots.repo.js'
import { logger } from '../../utils/logger.js'

export const createScreenshotsSlice = (set, get) => ({
  screenshots: [],

  requestScreenshot: async () => {
    const { user, selectedDeviceId, devices } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    const selectedDevice = devices.find(d => d.id === selectedDeviceId)
    if (!selectedDevice?.screenshotUploadToken) throw new Error('Device command token is not ready')
    logger.info(selectedDeviceId, 'Запрос скриншота экрана')
    await fsSendDeviceCommand(user.uid, selectedDeviceId, {
      command: 'screenshot_request',
      uploadToken: selectedDevice.screenshotUploadToken,
      requestedAtClientMs: Date.now()
    })
  },

  deleteScreenshot: async (screenshot) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    await fsDeleteScreenshot(user.uid, selectedDeviceId, screenshot)
  },

  getScreenshotDownloadURL: async (screenshot) => {
    return await fsGetScreenshotDownloadURL(screenshot)
  }
})
