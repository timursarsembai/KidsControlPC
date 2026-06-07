import { savePomodoroRule } from '../../firebase/rules.repo.js'
import { serverTimestamp } from '../../firebase/timestamps.js'

export const createPomodoroSlice = (set, get) => ({
  getPomodoroSession: () => {
    const { rules } = get()
    return rules.find(r => r.id === 'global_pomodoro' && r.type === 'pomodoro') || null
  },

  togglePomodoroSession: async (active, data = {}) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const payload = {
      type: 'pomodoro',
      status: active ? 'active' : 'inactive',
      ...data
    }
    if (active) {
      payload.startedAt = serverTimestamp()
      payload.startedAtClientMs = Date.now()
    }
    await savePomodoroRule(user.uid, selectedDeviceId, payload)
  }
})
