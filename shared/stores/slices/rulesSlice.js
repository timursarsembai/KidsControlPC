import { addRule, deleteRule, updateRule } from '../../firebase/rules.repo.js'
import { serverTimestamp } from '../../firebase/timestamps.js'
import { logger } from '../../utils/logger.js'

// Returns null when there's no signed-in user/selected device (callers bail out).
function getOwnerContext(get) {
  const { user, activeOwnerUid, selectedDeviceId } = get()
  if (!user || !selectedDeviceId) return null
  return { ownerUid: activeOwnerUid || user.uid, selectedDeviceId }
}

// Builds the timer/schedule/date/monthly_date fields shared by every rule-add call.
function buildTimingExtras(modeConfig = {}) {
  const timerConfig = modeConfig.timer ? { ...modeConfig.timer, startedAt: serverTimestamp() } : undefined
  return {
    ...(timerConfig && { timer: timerConfig }),
    ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
    ...(modeConfig.date && { date: modeConfig.date }),
    ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date })
  }
}

async function toggleRuleBlock(get, ruleId, currentlyBlocked, modeConfig, logLabel) {
  const ctx = getOwnerContext(get)
  if (!ctx) return
  const { ownerUid, selectedDeviceId } = ctx
  const { rules } = get()
  const rule = rules.find(r => r.id === ruleId)
  const updates = { status: currentlyBlocked ? 'inactive' : 'active' }
  if (modeConfig.timer) updates.timer = modeConfig.timer
  if (modeConfig.schedule) updates.schedule = modeConfig.schedule
  if (modeConfig.date) updates.date = modeConfig.date
  if (modeConfig.monthly_date) updates.monthly_date = modeConfig.monthly_date

  if (!currentlyBlocked && rule?.mode === 'timer') {
    updates.timer = { ...(updates.timer || rule.timer), startedAt: serverTimestamp() }
  }
  logger.info(selectedDeviceId, `Изменение блокировки ${logLabel} ${ruleId}: status = ${updates.status}`)
  await updateRule(ownerUid, selectedDeviceId, ruleId, updates)
}

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

  toggleProgramBlock: (ruleId, currentlyBlocked, modeConfig = {}) =>
    toggleRuleBlock(get, ruleId, currentlyBlocked, modeConfig, 'программы'),

  toggleWebsiteBlock: (ruleId, currentlyBlocked, modeConfig = {}) =>
    toggleRuleBlock(get, ruleId, currentlyBlocked, modeConfig, 'сайта'),

  addProgramRule: async (programData, mode, modeConfig = {}) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    const finalMode = mode || get().activeTab
    await addRule(ownerUid, selectedDeviceId, {
      type: 'program',
      mode: finalMode,
      program: { name: programData.name, executablePath: programData.path, hash: '' },
      ...buildTimingExtras(modeConfig)
    })
    logger.info(selectedDeviceId, `Добавлено правило программы: ${programData.name} (режим: ${finalMode})`)
  },

  addWebsite: async (entry, modeConfig = {}) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    const { activeTab } = get()
    await addRule(ownerUid, selectedDeviceId, {
      type: 'web',
      mode: activeTab,
      web: {
        inputUrl: entry.inputUrl,
        scope: entry.scope,
        resolvedPattern: entry.resolvedPattern,
        blockMethod: 'hosts'
      },
      ...buildTimingExtras(modeConfig)
    })
    logger.info(selectedDeviceId, `Добавлено правило сайта: ${entry.resolvedPattern} (режим: ${activeTab})`)
  },

  addPowerRule: async (action, mode, modeConfig = {}) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    await addRule(ownerUid, selectedDeviceId, {
      type: 'power',
      mode: mode,
      action: action,
      ...buildTimingExtras(modeConfig)
    })
  },

  addLockRule: async (message, mode, modeConfig = {}) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    await addRule(ownerUid, selectedDeviceId, {
      type: 'lock',
      mode: mode,
      message: message || '',
      ...buildTimingExtras(modeConfig)
    })
  },

  addReminderRule: async (message, settings, modeConfig) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    const mode = modeConfig.date ? 'date' : modeConfig.monthly_date ? 'monthly_date' : modeConfig.schedule ? 'schedule' : 'once'
    await addRule(ownerUid, selectedDeviceId, {
      type: 'reminder',
      mode: mode,
      message: message || '',
      voiceLoop: settings.voiceLoop || false,
      systemNotification: settings.systemNotification || false,
      ...buildTimingExtras(modeConfig)
    })
  },

  updateReminderRule: async (ruleId, message, settings, modeConfig) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
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
    await updateRule(ownerUid, selectedDeviceId, ruleId, updates)
  },

  removeRule: async (ruleId) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    logger.info(selectedDeviceId, `Удаление правила ${ruleId}`)
    await deleteRule(ownerUid, selectedDeviceId, ruleId)
  },

  removeWebsiteGlobally: async (pattern) => {
    const ctx = getOwnerContext(get)
    if (!ctx) return
    const { ownerUid, selectedDeviceId } = ctx
    const { rules } = get()
    const matchingRules = rules.filter(r => r.type === 'web' && (r.web?.resolvedPattern || r.web?.inputUrl) === pattern)
    for (const r of matchingRules) {
      await deleteRule(ownerUid, selectedDeviceId, r.id)
    }
  }
})
