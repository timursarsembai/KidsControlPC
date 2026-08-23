import { savePomodoroRule } from '../../data/rules.js'
import { serverTimestamp } from '../../data/timestamps.js'

export const createPomodoroSlice = (set, get) => ({
  getPomodoroSession: () => {
    const { rules } = get()
    return rules.find(r => r.id === 'global_pomodoro' && r.type === 'pomodoro') || null
  },

  togglePomodoroSession: async (active, data = {}) => {
    const { user, activeOwnerUid, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const ownerUid = activeOwnerUid || user.uid
    const payload = {
      type: 'pomodoro',
      status: active ? 'active' : 'inactive',
      ...data
    }
    if (active) {
      payload.startedAt = serverTimestamp()
      payload.startedAtClientMs = Date.now()
    }
    await savePomodoroRule(ownerUid, selectedDeviceId, payload)
  }
})
