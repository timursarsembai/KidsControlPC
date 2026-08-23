import { sendDeviceCommand as fsSendDeviceCommand } from '../../data/commands.js'
import { updateDeviceSettings as fsUpdateDeviceSettings } from '../../data/devices.js'
import { logger } from '../../utils/logger.js'

export const createCommandsSlice = (set, get) => ({
  sendDeviceCommand: async (commandData) => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    const ownerUid = activeOwnerUid || user.uid
    const action = commandData.action || commandData.command || commandData.type
    logger.info(selectedDeviceId, `Отправка команды: ${action}`)
    return await fsSendDeviceCommand(ownerUid, selectedDeviceId, commandData)
  },

  updateDeviceSettings: async (settings) => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    const ownerUid = activeOwnerUid || user.uid
    await fsUpdateDeviceSettings(ownerUid, selectedDeviceId, settings)
  }
})
