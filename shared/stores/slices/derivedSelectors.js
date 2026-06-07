export const createDerivedSelectors = (set, get) => ({
  getFilteredPrograms: () => {
    const { installedApps, rules, activeTab, programSearch, programFilter } = get()

    const ruleByPath = new Map()
    const ruleByName = new Map()
    rules.filter(r => r.type === 'program' && r.mode === activeTab).forEach(r => {
      if (r.program?.executablePath) ruleByPath.set(r.program.executablePath.toLowerCase(), r)
      if (r.program?.name) ruleByName.set(r.program.name.toLowerCase(), r)
    })

    return installedApps
      .map(app => {
        const rule = ruleByPath.get((app.path || '').toLowerCase()) ||
          ruleByName.get((app.name || '').toLowerCase())
        return {
          id: app.id,
          name: app.name,
          path: app.path || '',
          publisher: app.publisher || '',
          running: app.running || false,
          blocked: rule ? rule.status === 'active' : false,
          ruleId: rule?.id || null
        }
      })
      .filter(p => {
        if (programSearch && !p.name.toLowerCase().includes(programSearch.toLowerCase())) return false
        if (programFilter === 'blocked') return p.blocked
        if (programFilter === 'unblocked') return !p.blocked
        return true
      })
  },

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
          resolvedPattern: pattern
        })
      }
    })

    return Array.from(unique.values()).map(site => {
      const rule = rules.find(r =>
        r.type === 'web' &&
        r.mode === activeTab &&
        (r.web?.resolvedPattern || r.web?.inputUrl) === site.resolvedPattern
      )

      return {
        ...site,
        id: rule?.id || site.resolvedPattern,
        ruleId: rule?.id || null,
        blocked: rule ? rule.status === 'active' : false,
        rule: rule || null
      }
    })
  }
})
