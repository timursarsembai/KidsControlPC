import { subscribeToAlerts } from '../../firebase/alerts.repo.js'
import { subscribeToDevices } from '../../firebase/devices.repo.js'
import { initUserProfile } from '../../firebase/profile.repo.js'

export const createAuthSlice = (set, get) => ({
  user: null,
  userProfile: null,
  activeOwnerUid: null,
  accountRole: 'owner',
  _unsubDevices: null,
  _unsubAlerts: null,

  initFirebase: async (firebaseUser) => {
    const profile = await initUserProfile(firebaseUser.uid, firebaseUser.email)
    const activeOwnerUid = profile.ownerUid || firebaseUser.uid
    const accountRole = profile.role || (activeOwnerUid === firebaseUser.uid ? 'owner' : 'parent')

    set({
      user: firebaseUser,
      userProfile: profile,
      activeOwnerUid,
      accountRole
    })

    const unsubDevices = subscribeToDevices(activeOwnerUid, (devices) => {
      const prev = get()
      set({ devices })

      if (!prev.selectedDeviceId && devices.length > 0) {
        get().selectDevice(devices[0].id)
      }

      if (prev.selectedDeviceId && !devices.find(d => d.id === prev.selectedDeviceId)) {
        get().selectDevice(devices[0]?.id || null)
      }
    })

    const unsubAlerts = subscribeToAlerts(activeOwnerUid, (alerts) => {
      set({ alerts })
    })

    set({ _unsubDevices: unsubDevices, _unsubAlerts: unsubAlerts })

    get().initChats()
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
      userProfile: null,
      activeOwnerUid: null,
      accountRole: 'owner',
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
    get().cleanupChats()
  }
})
