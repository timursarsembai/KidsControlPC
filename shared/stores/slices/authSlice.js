import { subscribeToAlerts } from '../../firebase/alerts.repo.js'
import { subscribeToDevices } from '../../firebase/devices.repo.js'
import { initUserProfile } from '../../firebase/profile.repo.js'

export const createAuthSlice = (set, get) => ({
  user: null,
  _unsubDevices: null,
  _unsubAlerts: null,

  initFirebase: async (firebaseUser) => {
    set({ user: firebaseUser })
    await initUserProfile(firebaseUser.uid, firebaseUser.email)

    const unsubDevices = subscribeToDevices(firebaseUser.uid, (devices) => {
      const prev = get()
      set({ devices })

      if (!prev.selectedDeviceId && devices.length > 0) {
        get().selectDevice(devices[0].id)
      }

      if (prev.selectedDeviceId && !devices.find(d => d.id === prev.selectedDeviceId)) {
        get().selectDevice(devices[0]?.id || null)
      }
    })

    const unsubAlerts = subscribeToAlerts(firebaseUser.uid, (alerts) => {
      set({ alerts })
    })

    set({ _unsubDevices: unsubDevices, _unsubAlerts: unsubAlerts })
  },

  cleanup: () => {
    const { _unsubDevices, _unsubRules, _unsubApps, _unsubScreenshots, _unsubAlerts } = get()
    _unsubDevices?.()
    _unsubRules?.()
    _unsubApps?.()
    _unsubScreenshots?.()
    _unsubAlerts?.()
    set({
      user: null,
      devices: [],
      rules: [],
      installedApps: [],
      screenshots: [],
      alerts: [],
      selectedDeviceId: null,
      _unsubDevices: null,
      _unsubRules: null,
      _unsubApps: null,
      _unsubScreenshots: null,
      _unsubAlerts: null
    })
  }
})
