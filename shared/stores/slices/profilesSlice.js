import { addRule, deleteRule, updateRule } from '../../firebase/rules.repo.js'

export const createProfilesSlice = (set, get) => ({
  addProfileMode: async (profileName, profileIcon = '🧩') => {
    const { user, selectedDeviceId } = get()
    if (!user || !selectedDeviceId) return null
    const name = profileName?.trim() || 'Новый режим'
    const profileId = `profile_${Date.now()}`
    await addRule(user.uid, selectedDeviceId, {
      type: 'profile_config',
      mode: 'profile',
      profileId,
      profileName: name,
      profileIcon,
      schedule: {
        action: 'allow',
        groups: [
          {
            weekdays: [0, 1, 2, 3, 4],
            ranges: [{ timeFrom: '10:00', timeTo: '12:00' }]
          }
        ]
      }
    })
    return profileId
  },

  deleteProfileMode: async (profileId) => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId || !profileId) return
    const profileRules = rules.filter(r => r.mode === 'profile' && r.profileId === profileId)
    for (const rule of profileRules) {
      await deleteRule(user.uid, selectedDeviceId, rule.id)
    }
    if (get().activeTab === profileId) {
      set({ activeTab: 'permanent', activeSubTab: 'programs' })
    }
  },

  saveProfileRules: async (profileId, profileName, schedule, targets = {}, profileIcon = '🧩') => {
    const { user, selectedDeviceId, rules } = get()
    if (!user || !selectedDeviceId || !profileId) return

    const profileRules = rules.filter(r => r.mode === 'profile' && r.profileId === profileId)
    const profileConfig = profileRules.find(r => r.type === 'profile_config')
    const basePayload = {
      mode: 'profile',
      profileId,
      profileName,
      profileIcon,
      schedule
    }

    if (profileConfig) {
      await updateRule(user.uid, selectedDeviceId, profileConfig.id, {
        ...basePayload,
        status: 'active'
      })
    } else {
      await addRule(user.uid, selectedDeviceId, {
        ...basePayload,
        type: 'profile_config'
      })
    }

    const desiredPrograms = new Map((targets.programs || []).map(program => [program.name, program]))
    const existingPrograms = profileRules.filter(r => r.type === 'program')

    for (const rule of existingPrograms) {
      const name = rule.program?.name
      if (!desiredPrograms.has(name)) {
        await deleteRule(user.uid, selectedDeviceId, rule.id)
      }
    }

    for (const program of desiredPrograms.values()) {
      const existing = existingPrograms.find(rule =>
        rule.program?.name === program.name ||
        (program.path && rule.program?.executablePath === program.path)
      )
      const payload = {
        ...basePayload,
        status: 'active',
        program: {
          name: program.name,
          executablePath: program.path || '',
          hash: ''
        }
      }

      if (existing) {
        await updateRule(user.uid, selectedDeviceId, existing.id, payload)
      } else {
        await addRule(user.uid, selectedDeviceId, {
          ...payload,
          type: 'program'
        })
      }
    }

    const desiredWebsites = new Map((targets.websites || []).map(site => {
      const pattern = site.resolvedPattern || site.inputUrl
      return [pattern, { ...site, resolvedPattern: pattern }]
    }))
    const existingWebsites = profileRules.filter(r => r.type === 'web')

    for (const rule of existingWebsites) {
      const pattern = rule.web?.resolvedPattern || rule.web?.inputUrl
      if (!desiredWebsites.has(pattern)) {
        await deleteRule(user.uid, selectedDeviceId, rule.id)
      }
    }

    for (const site of desiredWebsites.values()) {
      const existing = existingWebsites.find(rule =>
        (rule.web?.resolvedPattern || rule.web?.inputUrl) === site.resolvedPattern
      )
      const payload = {
        ...basePayload,
        status: 'active',
        web: {
          inputUrl: site.inputUrl || site.resolvedPattern,
          scope: site.scope || 'domain',
          resolvedPattern: site.resolvedPattern,
          blockMethod: 'hosts'
        }
      }

      if (existing) {
        await updateRule(user.uid, selectedDeviceId, existing.id, payload)
      } else {
        await addRule(user.uid, selectedDeviceId, {
          ...payload,
          type: 'web'
        })
      }
    }
  }
})
