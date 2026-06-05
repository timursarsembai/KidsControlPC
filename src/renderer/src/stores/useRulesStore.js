import { create } from 'zustand'
import {
  addRule, updateRule, deleteRule, subscribeToRules,
  subscribeToDevices, updateDeviceAlias, removeDevice,
  subscribeToInstalledApps,
  subscribeToAlerts, acknowledgeAlert, acknowledgeAllAlerts,
  initUserProfile, serverTimestamp, savePomodoroRule,
  sendDeviceCommand as fsSendDeviceCommand, updateDeviceSettings as fsUpdateDeviceSettings,
  subscribeToScreenshots, deleteScreenshot as fsDeleteScreenshot
} from '../firebase/firestore'

const PROTECTED_APP_NAME_PARTS = [
  'kidscontrol agent',
  'kidscontrolpc agent',
  'kidscontrolpc child agent',
  'kidscontrol pc agent'
]

const PROTECTED_APP_PATH_PARTS = [
  '\\kidscontrolagent',
  '\\kidscontrolpc agent'
]

function isProtectedInstalledApp(app = {}) {
  const name = String(app.name || '').toLowerCase()
  const path = String(app.path || '').toLowerCase().replace(/\//g, '\\')
  return PROTECTED_APP_NAME_PARTS.some(part => name.includes(part))
    || PROTECTED_APP_PATH_PARTS.some(part => path.includes(part))
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useRulesStore = create((set, get) => ({

  // Auth
  user: null,

  // UI state
  selectedDeviceId: null,   // which child PC is selected
  activeTab:        'permanent',
  activeSubTab:     'programs',
  programSearch:    '',
  programFilter:    'all',
  showSettings:     false,

  // Firestore data
  devices:       [],   // all child devices
  rules:         [],   // rules for selectedDevice
  installedApps: [],   // apps installed on selectedDevice (from agent)
  screenshots:   [],
  alerts:        [],

  // Loading
  rulesLoading: true,
  appsLoading:  true,

  // Active subscriptions
  _unsubDevices:  null,
  _unsubRules:    null,
  _unsubApps:     null,
  _unsubScreenshots: null,
  _unsubAlerts:   null,

  // ── UI setters ──
  setActiveTab:      (tab) => set({ activeTab: tab }),
  setActiveSubTab:   (sub) => set({ activeSubTab: sub }),
  setProgramSearch:  (q)   => set({ programSearch: q }),
  setProgramFilter:  (f)   => set({ programFilter: f }),
  setShowSettings:   (v)   => set({ showSettings: v }),

  // ── Select a device → re-subscribe rules + apps ──
  selectDevice: (deviceId) => {
    const { user, _unsubRules, _unsubApps, _unsubScreenshots } = get()
    if (!user) return

    // Unsubscribe previous
    _unsubRules?.()
    _unsubApps?.()
    _unsubScreenshots?.()

    set({ selectedDeviceId: deviceId, rules: [], installedApps: [], screenshots: [], rulesLoading: true, appsLoading: true })

    if (!deviceId) return

    const unsubRules = subscribeToRules(user.uid, deviceId, (rules) => {
      set({ rules, rulesLoading: false })
    })

    const unsubApps = subscribeToInstalledApps(user.uid, deviceId, (apps) => {
      set({ installedApps: apps.filter(app => !isProtectedInstalledApp(app)), appsLoading: false })
    })

    const unsubScreenshots = subscribeToScreenshots(user.uid, deviceId, (screenshots) => {
      set({ screenshots })
    })

    set({ _unsubRules: unsubRules, _unsubApps: unsubApps, _unsubScreenshots: unsubScreenshots })
  },

  // ── Firebase Init on Login ──
  initFirebase: async (firebaseUser) => {
    set({ user: firebaseUser })
    await initUserProfile(firebaseUser.uid, firebaseUser.email)

    // Subscribe to devices
    const unsubDevices = subscribeToDevices(firebaseUser.uid, (devices) => {
      const prev = get()
      set({ devices })
      // Auto-select first device if none selected
      if (!prev.selectedDeviceId && devices.length > 0) {
        get().selectDevice(devices[0].id)
      }
      // If selected device was removed, clear selection
      if (prev.selectedDeviceId && !devices.find(d => d.id === prev.selectedDeviceId)) {
        get().selectDevice(devices[0]?.id || null)
      }
    })

    // Subscribe to alerts
    const unsubAlerts = subscribeToAlerts(firebaseUser.uid, (alerts) => {
      set({ alerts })
    })

    set({ _unsubDevices: unsubDevices, _unsubAlerts: unsubAlerts })
  },

  // ── Cleanup on Logout ──
  cleanup: () => {
    const { _unsubDevices, _unsubRules, _unsubApps, _unsubScreenshots, _unsubAlerts } = get()
    _unsubDevices?.()
    _unsubRules?.()
    _unsubApps?.()
    _unsubScreenshots?.()
    _unsubAlerts?.()
    set({
      user: null, devices: [], rules: [], installedApps: [], screenshots: [], alerts: [],
      selectedDeviceId: null,
      _unsubDevices: null, _unsubRules: null, _unsubApps: null, _unsubScreenshots: null, _unsubAlerts: null
    })
  },

  // ── Device management ──
  renameDevice: async (deviceId, alias) => {
    const { user } = get()
    if (!user) return
    await updateDeviceAlias(user.uid, deviceId, alias)
  },

  deleteDevice: async (deviceId) => {
    const { user } = get()
    if (!user) return
    await removeDevice(user.uid, deviceId)
  },

  // ── Rules: conflict check ──
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

  // ── Rules: block/unblock ──
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
    await updateRule(user.uid, selectedDeviceId, ruleId, updates)
  },

  // ── Add program rule ──
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
      ...(modeConfig.date     && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date }),
    })
  },

  // ── Add web rule ──
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
      ...(modeConfig.date     && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date }),
    })
  },

  // ── Add power rule (shutdown, restart, sleep, hibernate) ──
  addPowerRule: async (action, mode, modeConfig = {}) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const timerConfig = modeConfig.timer ? { ...modeConfig.timer, startedAt: serverTimestamp() } : undefined
    await addRule(user.uid, selectedDeviceId, {
      type: 'power',
      mode: mode,
      action: action, // 'shutdown', 'restart', 'sleep', 'hibernate'
      ...(timerConfig && { timer: timerConfig }),
      ...(modeConfig.schedule && { schedule: modeConfig.schedule }),
      ...(modeConfig.date     && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date }),
    })
  },

  // ── Add lock rule (custom lock screen) ──
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
      ...(modeConfig.date     && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date }),
    })
  },

  // ── Add reminder rule ──
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
      ...(modeConfig.date     && { date: modeConfig.date }),
      ...(modeConfig.monthly_date && { monthly_date: modeConfig.monthly_date }),
    })
  },

  // ── Update reminder rule ──
  updateReminderRule: async (ruleId, message, settings, modeConfig) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const mode = modeConfig.date ? 'date' : modeConfig.monthly_date ? 'monthly_date' : modeConfig.schedule ? 'schedule' : 'once'
    
    // Create updates object and explicitly null out unused mode configs so they get cleared
    const updates = {
      mode: mode,
      message: message || '',
      voiceLoop: settings.voiceLoop || false,
      systemNotification: settings.systemNotification || false,
      schedule: modeConfig.schedule || null,
      date: modeConfig.date || null,
      monthly_date: modeConfig.monthly_date || null,
    }
    await updateRule(user.uid, selectedDeviceId, ruleId, updates)
  },

  // ── Delete rule ──
  removeRule: async (ruleId) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    await deleteRule(user.uid, selectedDeviceId, ruleId)
  },

  // ── Remove website from all modes ──
  removeWebsiteGlobally: async (pattern) => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId) return
    const matchingRules = rules.filter(r => r.type === 'web' && (r.web?.resolvedPattern || r.web?.inputUrl) === pattern)
    for (const r of matchingRules) {
      await deleteRule(user.uid, selectedDeviceId, r.id)
    }
  },

  // ── Pomodoro Management ──
  getPomodoroSession: () => {
    const { rules } = get()
    return rules.find(r => r.id === 'global_pomodoro' && r.type === 'pomodoro') || null
  },

  togglePomodoroSession: async (active, data = {}) => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId) return
    const currentSession = rules.find(r => r.id === 'global_pomodoro' && r.type === 'pomodoro')
    const payload = {
      type: 'pomodoro',
      status: active ? 'active' : 'inactive',
      ...data
    }
    if (active) {
      if (currentSession?.status !== 'active') {
        payload.startedAt = serverTimestamp()
        payload.startedAtClientMs = Date.now()
        payload.elapsedBeforePauseMs = Number(data.elapsedBeforePauseMs ?? currentSession?.pausedElapsedMs ?? 0)
        payload.pausedElapsedMs = null
        payload.pausedAt = null
      }
    } else {
      payload.startedAt = null
      payload.startedAtClientMs = null
      payload.elapsedBeforePauseMs = 0
      payload.pausedElapsedMs = 0
      payload.pausedAt = null
    }
    await savePomodoroRule(user.uid, selectedDeviceId, payload)
  },

  pausePomodoroSession: async (elapsedMs = 0) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const safeElapsedMs = Math.max(0, Math.floor(Number(elapsedMs) || 0))
    await savePomodoroRule(user.uid, selectedDeviceId, {
      type: 'pomodoro',
      status: 'paused',
      pausedElapsedMs: safeElapsedMs,
      elapsedBeforePauseMs: safeElapsedMs,
      pausedAt: serverTimestamp()
    })
  },

  stopPomodoroSession: async () => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    await savePomodoroRule(user.uid, selectedDeviceId, {
      type: 'pomodoro',
      status: 'inactive',
      startedAt: null,
      startedAtClientMs: null,
      elapsedBeforePauseMs: 0,
      pausedElapsedMs: 0,
      pausedAt: null
    })
  },

  // ── Alert actions ──
  acknowledgeAlert: async (alertId) => {
    const { user } = get()
    if (!user) return
    await acknowledgeAlert(user.uid, alertId)
  },

  acknowledgeAllAlerts: async () => {
    const { user, alerts } = get()
    if (!user) return
    const unread = alerts.filter(a => !a.acknowledged).map(a => a.id)
    if (unread.length === 0) return
    await acknowledgeAllAlerts(user.uid, unread)
  },

  // ── Commands ──
  sendDeviceCommand: async (commandData) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    await fsSendDeviceCommand(user.uid, selectedDeviceId, commandData)
  },

  updateDeviceSettings: async (settings) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    await fsUpdateDeviceSettings(user.uid, selectedDeviceId, settings)
  },

  requestScreenshot: async () => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) throw new Error('No device selected')
    await fsSendDeviceCommand(user.uid, selectedDeviceId, {
      command: 'screenshot_request',
      requestedAtClientMs: Date.now()
    })
  },

  deleteScreenshot: async (screenshot) => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    await fsDeleteScreenshot(user.uid, selectedDeviceId, screenshot)
  },

  // ── Derived: programs from installedApps merged with rules ──
  getFilteredPrograms: () => {
    const { installedApps, rules, activeTab, programSearch, programFilter } = get()

    // Build rule lookup: path.lower → rule, name.lower → rule
    const ruleByPath = new Map()
    const ruleByName = new Map()
    rules.filter(r => r.type === 'program' && r.mode === activeTab).forEach(r => {
      if (r.program?.executablePath) ruleByPath.set(r.program.executablePath.toLowerCase(), r)
      if (r.program?.name)           ruleByName.set(r.program.name.toLowerCase(), r)
    })

    return installedApps
      .map(app => {
        const rule = ruleByPath.get((app.path || '').toLowerCase())
                  || ruleByName.get((app.name || '').toLowerCase())
        return {
          id:      app.id,
          name:    app.name,
          path:    app.path || '',
          publisher: app.publisher || '',
          running: app.running || false,  // agent updates this
          blocked: rule ? rule.status === 'active' : false,
          ruleId:  rule?.id || null,
        }
      })
      .filter(p => {
        if (programSearch && !p.name.toLowerCase().includes(programSearch.toLowerCase())) return false
        if (programFilter === 'blocked')   return p.blocked
        if (programFilter === 'unblocked') return !p.blocked
        return true
      })
  },

  // ── Derived: websites for current mode ──
  getFilteredWebsites: () => {
    const { rules, activeTab } = get()
    
    const unique = new Map()
    rules.filter(r => r.type === 'web').forEach(r => {
      const pattern = r.web?.resolvedPattern || r.web?.inputUrl
      if (!pattern) return
      if (!unique.has(pattern)) {
        unique.set(pattern, {
          inputUrl: r.web?.inputUrl || '',
          scope: r.web?.scope || 'domain',
          resolvedPattern: pattern,
        })
      }
    })

    return Array.from(unique.values()).map(site => {
      const rule = rules.find(r => r.type === 'web' && r.mode === activeTab && 
        (r.web?.resolvedPattern || r.web?.inputUrl) === site.resolvedPattern)

      return {
        ...site,
        id: rule?.id || site.resolvedPattern, // use pattern as fallback key
        ruleId: rule?.id || null,
        blocked: rule ? rule.status === 'active' : false,
        rule: rule || null
      }
    })
  },
}))
