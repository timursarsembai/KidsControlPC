import {
  acknowledgeAlert as fsAcknowledgeAlert,
  acknowledgeAllAlerts as fsAcknowledgeAllAlerts
} from '../../firebase/alerts.repo.js'

export const createAlertsSlice = (set, get) => ({
  alerts: [],

  acknowledgeAlert: async (alertId) => {
    const { user, activeOwnerUid } = get()
    if (!user) return
    const ownerUid = activeOwnerUid || user.uid
    await fsAcknowledgeAlert(ownerUid, alertId)
  },

  acknowledgeAllAlerts: async () => {
    const { user, activeOwnerUid, alerts } = get()
    if (!user) return
    const unread = alerts.filter(a => !a.acknowledged).map(a => a.id)
    if (unread.length === 0) return
    const ownerUid = activeOwnerUid || user.uid
    await fsAcknowledgeAllAlerts(ownerUid, unread)
  }
})
