import { create } from 'zustand'
import {
  addRule, updateRule, deleteRule, subscribeToRules,
  subscribeToDevices, updateDeviceAlias, removeDevice,
  subscribeToInstalledApps,
  subscribeToAlerts, acknowledgeAlert, acknowledgeAllAlerts,
  initUserProfile, serverTimestamp, savePomodoroRule
} from '../firebase/firestore'

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
  alerts:        [],

  // Loading
  rulesLoading: true,
  appsLoading:  true,

  // Active subscriptions
  _unsubDevices:  null,
  _unsubRules:    null,
  _unsubApps:     null,
  _unsubAlerts:   null,

  // ── UI setters ──
  setActiveTab:      (tab) => set({ activeTab: tab }),
  setActiveSubTab:   (sub) => set({ activeSubTab: sub }),
  setProgramSearch:  (q)   => set({ programSearch: q }),
  setProgramFilter:  (f)   => set({ programFilter: f }),
  setShowSettings:   (v)   => set({ showSettings: v }),

  // ── Select a device → re-subscribe rules + apps ──
  selectDevice: (deviceId) => {
    const { user, _unsubRules, _unsubApps } = get()
    if (!user) return

    // Unsubscribe previous
    _unsubRules?.()
    _unsubApps?.()

    set({ selectedDeviceId: deviceId, rules: [], installedApps: [], rulesLoading: true, appsLoading: true })

    if (!deviceId) return

    const unsubRules = subscribeToRules(user.uid, deviceId, (rules) => {
      set({ rules, rulesLoading: false })
    })

    const unsubApps = subscribeToInstalledApps(user.uid, deviceId, (apps) => {
      set({ installedApps: apps, appsLoading: false })
    })

    set({ _unsubRules: unsubRules, _unsubApps: unsubApps })
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
    const { _unsubDevices, _unsubRules, _unsubApps, _unsubAlerts } = get()
    _unsubDevices?.()
    _unsubRules?.()
    _unsubApps?.()
    _unsubAlerts?.()
    set({
      user: null, devices: [], rules: [], installedApps: [], alerts: [],
      selectedDeviceId: null,
      _unsubDevices: null, _unsubRules: null, _unsubApps: null, _unsubAlerts: null
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
    })
  },

  // ── Remove rule ──
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
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return
    const payload = {
      type: 'pomodoro',
      status: active ? 'active' : 'inactive',
      ...data
    }
    if (active) {
      payload.startedAt = serverTimestamp()
    }
    await savePomodoroRule(user.uid, selectedDeviceId, payload)
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
