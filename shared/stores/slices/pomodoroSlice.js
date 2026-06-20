import { savePomodoroRule } from '../../firebase/rules.repo.js'
import { serverTimestamp } from '../../firebase/timestamps.js'

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
