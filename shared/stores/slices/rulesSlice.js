import { addRule, deleteRule, updateRule } from '../../firebase/rules.repo.js'
import { serverTimestamp } from '../../firebase/timestamps.js'
import { logger } from '../../utils/logger.js'

export const createRulesSlice = (set, get) => ({
  rules: [],

  checkRuleConflict: (targetType, targetName, desiredMode, ignoreRuleId = null) => {
    const { rules } = get()
    const activeRules = rules.filter(r => r.status === 'active' && r.id !== ignoreRuleId)

    const normalConflict = activeRules.find(r => {
      if (r.type === 'pomodoro') return false
      if (r.type !== targetType) return false
      if (r.mode === desiredMode) return false
      if (targetType === 'program' && r.program?.name === targetName) return true
      if (targetType === 'web' && r.web?.resolvedPattern === targetName) return true
      return false
    })
    if (normalConflict) return normalConflict

    const pomodoroRule = activeRules.find(r => r.type === 'pomodoro')
    if (pomodoroRule && desiredMode !== 'pomodoro') {
      if (targetType === 'program' && pomodoroRule.targets?.programs?.includes(targetName)) return pomodoroRule
      if (targetType === 'web' && pomodoroRule.targets?.websites?.includes(targetName)) return pomodoroRule
    }
    return null
  },

  toggleProgramBlock: async (ruleId, currentlyBlocked, modeConfig = {}) => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId) return
    const rule = rules.find(r => r.id === ruleId)
    const updates = { status: currentlyBlocked ? 'inactive' : 'active' }

    if (modeConfig.timer) updates.timer = modeConfig.timer
    if (modeConfig.schedule) updates.schedule = modeConfig.schedule
    if (modeConfig.date) updates.date = modeConfig.date
    if (modeConfig.monthly_date) updates.monthly_date = modeConfig.monthly_date

    if (!currentlyBlocked && rule?.mode === 'timer') {
      updates.timer = { ...(updates.timer || rule.timer), startedAt: serverTimestamp() }
    }
    logger.info(selectedDeviceId, `Изменение блокировки программы ${ruleId}: status = ${updates.status}`)
    await updateRule(user.uid, selectedDeviceId, ruleId, updates)
  },

  toggleWebsiteBlock: async (ruleId, currentlyBlocked, modeConfig = {}) => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId) return
    const rule = rules.find(r => r.id === ruleId)
    const updates = { status: currentlyBlocked ? 'inactive' : 'active' }

    if (modeConfig.timer) updates.timer = modeConfig.timer
    if (modeConfig.schedule) updates.schedule = modeConfig.schedule
    if (modeConfig.date) updates.date = modeConfig.date
    if (modeConfig.monthly_date) updates.monthly_date = modeConfig.monthly_date

    if (!currentlyBlocked && rule?.mode === 'timer') {
      updates.timer = { ...(updates.timer || rule.timer), startedAt: serverTimestamp() }
    }
    logger.info(selectedDeviceId, `Изменение блокировки сайта ${ruleId}: status = ${updates.status}`)
    await updateRule(user.uid, selectedDeviceId, ruleId, updates)
  },

  addProgramRule: async (programData, mode, modeConfig = {}) => {
    const { user, selectedDeviceId, activeTab } = get()
    if (!user || !selectedDeviceId) return
    const finalMode = mode || activeTab
    const timerConfig = modeConfig.timer ? { ...modeConfig.timer, startedAt: serverTimestamp() } : undefined
    await addRule(user.uid, selectedDeviceId, {
      type: 'program',
      mode: finalMode,
      program: { name: programData.name, executablePath: programData.path, hash: '' },
      ...(timerConfig && { timer: timerConfig }),
      ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
      ...(modeConfig.date && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date })
    })
    logger.info(selectedDeviceId, `Добавлено правило программы: ${programData.name} (режим: ${finalMode})`)
  },

  addWebsite: async (entry, modeConfig = {}) => {
    const { user, selectedDeviceId, activeTab } = get()
    if (!user || !selectedDeviceId) return
    const timerConfig = modeConfig.timer ? { ...modeConfig.timer, startedAt: serverTimestamp() } : undefined
    await addRule(user.uid, selectedDeviceId, {
      type: 'web',
      mode: activeTab,
      web: {
        inputUrl: entry.inputUrl,
        scope: entry.scope,
        resolvedPattern: entry.resolvedPattern,
        blockMethod: 'hosts'
      },
      ...(timerConfig && { timer: timerConfig }),
      ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
      ...(modeConfig.date && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date })
    })
    logger.info(selectedDeviceId, `Добавлено правило сайта: ${entry.resolvedPattern} (режим: ${activeTab})`)
  },

  addPowerRule: async (action, mode, modeConfig = {}) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const timerConfig = modeConfig.timer ? { ...modeConfig.timer, startedAt: serverTimestamp() } : undefined
    await addRule(user.uid, selectedDeviceId, {
      type: 'power',
      mode: mode,
      action: action,
      ...(timerConfig && { timer: timerConfig }),
      ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
      ...(modeConfig.date && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date })
    })
  },

  addLockRule: async (message, mode, modeConfig = {}) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const timerConfig = modeConfig.timer ? { ...modeConfig.timer, startedAt: serverTimestamp() } : undefined
    await addRule(user.uid, selectedDeviceId, {
      type: 'lock',
      mode: mode,
      message: message || '',
      ...(timerConfig && { timer: timerConfig }),
      ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
      ...(modeConfig.date && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date })
    })
  },

  addReminderRule: async (message, settings, modeConfig) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const mode = modeConfig.date ? 'date' : modeConfig.monthly_date ? 'monthly_date' : modeConfig.schedule ? 'schedule' : 'once'
    await addRule(user.uid, selectedDeviceId, {
      type: 'reminder',
      mode: mode,
      message: message || '',
      voiceLoop: settings.voiceLoop || false,
      systemNotification: settings.systemNotification || false,
      ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
      ...(modeConfig.date && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date })
    })
  },

  updateReminderRule: async (ruleId, message, settings, modeConfig) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const mode = modeConfig.date ? 'date' : modeConfig.monthly_date ? 'monthly_date' : modeConfig.schedule ? 'schedule' : 'once'

    const updates = {
      mode: mode,
      message: message || '',
      voiceLoop: settings.voiceLoop || false,
      systemNotification: settings.systemNotification || false,
      schedule: modeConfig.schedule || null,
      date: modeConfig.date || null,
      monthly_date: modeConfig.monthly_date || null
    }
    await updateRule(user.uid, selectedDeviceId, ruleId, updates)
  },

  removeRule: async (ruleId) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    logger.info(selectedDeviceId, `Удаление правила ${ruleId}`)
    await deleteRule(user.uid, selectedDeviceId, ruleId)
  },

  removeWebsiteGlobally: async (pattern) => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId) return
    const matchingRules = rules.filter(r => r.type === 'web' && (r.web?.resolvedPattern || r.web?.inputUrl) === pattern)
    for (const r of matchingRules) {
      await deleteRule(user.uid, selectedDeviceId, r.id)
    }
  }
})
