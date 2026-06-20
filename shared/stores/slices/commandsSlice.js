import { sendDeviceCommand as fsSendDeviceCommand } from '../../firebase/commands.repo.js'
import { updateDeviceSettings as fsUpdateDeviceSettings } from '../../firebase/devices.repo.js'
import { logger } from '../../utils/logger.js'

export const createCommandsSlice = (set, get) => ({
  sendDeviceCommand: async (commandData) => {
    const { user, activeOwnerUid, selectedDeviceId, devices } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    const ownerUid = activeOwnerUid || user.uid
    const selectedDevice = devices.find(d => d.id === selectedDeviceId)
    if (!selectedDevice?.screenshotUploadToken) throw new Error('Device command token is not ready')
    logger.info(selectedDeviceId, `Отправка команды: ${commandData.command}`)
    await fsSendDeviceCommand(ownerUid, selectedDeviceId, {
      ...commandData,
      uploadToken: selectedDevice.screenshotUploadToken
    })
  },

  updateDeviceSettings: async (settings) => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    const ownerUid = activeOwnerUid || user.uid
    await fsUpdateDeviceSettings(ownerUid, selectedDeviceId, settings)
  }
})
