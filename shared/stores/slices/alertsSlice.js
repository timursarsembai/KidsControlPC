import {
  acknowledgeAlert as fsAcknowledgeAlert,
  acknowledgeAllAlerts as fsAcknowledgeAllAlerts
} from '../../firebase/alerts.repo.js'

export const createAlertsSlice = (set, get) => ({
  alerts: [],

  acknowledgeAlert: async (alertId) => {
    const { user } = get()
    if (!user) return
    await fsAcknowledgeAlert(user.uid, alertId)
  },

  acknowledgeAllAlerts: async () => {
    const { user, alerts } = get()
    if (!user) return
    const unread = alerts.filter(a => !a.acknowledged).map(a => a.id)
    if (unread.length === 0) return
    await fsAcknowledgeAllAlerts(user.uid, unread)
  }
})
