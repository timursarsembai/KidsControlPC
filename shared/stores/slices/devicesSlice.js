import { subscribeToInstalledApps } from '../../firebase/apps.repo.js'
import { removeDevice, updateDeviceAlias } from '../../firebase/devices.repo.js'
import { subscribeToRules } from '../../firebase/rules.repo.js'
import { subscribeToScreenshots } from '../../firebase/screenshots.repo.js'
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
    const { user, _unsubRules, _unsubApps, _unsubScreenshots } = get()
    if (!user) return

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

    const unsubRules = subscribeToRules(user.uid, deviceId, (rules) => {
      set({ rules, rulesLoading: false })
    })

    const unsubApps = subscribeToInstalledApps(user.uid, deviceId, (apps) => {
      set({ installedApps: apps, appsLoading: false })
    })

    const unsubScreenshots = subscribeToScreenshots(user.uid, deviceId, (screenshots) => {
      set({ screenshots })
    })

    set({ _unsubRules: unsubRules, _unsubApps: unsubApps, _unsubScreenshots: unsubScreenshots })
  },

  renameDevice: async (deviceId, alias) => {
    const { user } = get()
    if (!user) return
    logger.info('general', `Переименование устройства ${deviceId} в ${alias}`)
    await updateDeviceAlias(user.uid, deviceId, alias)
  },

  deleteDevice: async (deviceId) => {
    const { user } = get()
    if (!user) return
    logger.info('general', `Удаление устройства ${deviceId}`)
    await removeDevice(user.uid, deviceId)
  }
})
