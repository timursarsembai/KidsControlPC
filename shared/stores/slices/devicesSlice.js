import { subscribeToInstalledApps } from '../../data/apps.js'
import { removeDevice, updateDeviceAlias } from '../../data/devices.js'
import { subscribeToRules } from '../../data/rules.js'
import { subscribeToScreenshots } from '../../data/screenshots.js'
import { logger } from '../../utils/logger.js'

export const createDevicesSlice = (set, get) => ({
  selectedDeviceId: null,
  devices: [],
  installedApps: [],
  rulesLoading: true,
  appsLoading: true,
  _unsubRules: null,
  _unsubApps: null,
  _unsubScreenshots: null,

  selectDevice: (deviceId) => {
    const { user, activeOwnerUid, _unsubRules, _unsubApps, _unsubScreenshots } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid

    _unsubRules?.()
    _unsubApps?.()
    _unsubScreenshots?.()

    set({
      selectedDeviceId: deviceId,
      rules: [],
      installedApps: [],
      screenshots: [],
      rulesLoading: true,
      appsLoading: true
    })

    if (!deviceId) {
      logger.info('general', 'Устройство отменено (нет выбора)')
      return
    }

    logger.info('general', `Выбрано устройство: ${deviceId}`)

    const unsubRules = subscribeToRules(ownerUid, deviceId, (rules) => {
      set({ rules, rulesLoading: false })
    })

    const unsubApps = subscribeToInstalledApps(ownerUid, deviceId, (apps) => {
      set({ installedApps: apps, appsLoading: false })
    })

    const unsubScreenshots = subscribeToScreenshots(ownerUid, deviceId, (screenshots) => {
      set({ screenshots })
    })

    set({ _unsubRules: unsubRules, _unsubApps: unsubApps, _unsubScreenshots: unsubScreenshots })
  },

  renameDevice: async (deviceId, alias) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    logger.info('general', `Переименование устройства ${deviceId} в ${alias}`)
    await updateDeviceAlias(ownerUid, deviceId, alias)
  },

  deleteDevice: async (deviceId) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    logger.info('general', `Удаление устройства ${deviceId}`)
    await removeDevice(ownerUid, deviceId)
  }
})
