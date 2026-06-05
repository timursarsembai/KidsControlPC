import { useEffect, useMemo, useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { evaluateRule } from '@kidscontrol/shared/utils/timeHelpers'
import Select from '../Select/Select'
import TimeInput from '../TimeInput/TimeInput'
import './ProfilePanel.css'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const PROFILE_ICONS = ['🧩', '🎮', '📚', '📖', '🌙', '☀️', '🎧', '🎨', '💻', '🧠', '⚽', '🍿']

const DEFAULT_SCHEDULE = {
  action: 'allow',
  groups: [
    {
      action: 'allow',
      weekdays: [0, 1, 2, 3, 4],
      ranges: [
        { timeFrom: '10:00', timeTo: '12:00' },
        { timeFrom: '16:00', timeTo: '19:00' }
      ]
    },
    {
      action: 'allow',
      weekdays: [5, 6],
      ranges: [{ timeFrom: '07:00', timeTo: '21:00' }]
    }
  ]
}

function normalizeSchedule(schedule) {
  const normalizeRange = (range, fallback = { timeFrom: '07:00', timeTo: '21:00' }) => ({
    timeFrom: range?.timeFrom || fallback.timeFrom,
    timeTo: range?.timeTo || fallback.timeTo
  })

  const normalizeGroup = (group) => ({
    action: group?.action || schedule?.action || 'allow',
    weekdays: Array.isArray(group?.weekdays) ? group.weekdays : [0, 1, 2, 3, 4, 5, 6],
    ranges: Array.isArray(group?.ranges) && group.ranges.length > 0
      ? group.ranges.map(range => normalizeRange(range))
      : [{ timeFrom: '07:00', timeTo: '21:00' }]
  })

  const groups = Array.isArray(schedule?.groups) && schedule.groups.length > 0
    ? schedule.groups.map(normalizeGroup)
    : Array.isArray(schedule?.ranges) && schedule.ranges.length > 0
      ? [normalizeGroup({ weekdays: schedule.weekdays, ranges: schedule.ranges })]
      : DEFAULT_SCHEDULE.groups.map(normalizeGroup)

  return {
    action: schedule?.action || 'allow',
    groups
  }
}

function resolvePattern(url) {
  try {
    const cleaned = url.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
    return cleaned.split('/')[0]
  } catch {
    return url.trim()
  }
}

export default function ProfilePanel({ profileId }) {
  const {
    activeSubTab,
    installedApps,
    rules,
    appsLoading,
    rulesLoading,
    saveProfileRules
  } = useRulesStore()

  const profileTitleFallback = 'Новый режим'
  const [profileNameDraft, setProfileNameDraft] = useState(null)
  const [profileIconDraft, setProfileIconDraft] = useState(null)
  const [scheduleDraft, setScheduleDraft] = useState(null)
  const [selectedProgramsDraft, setSelectedProgramsDraft] = useState(null)
  const [selectedWebsitesDraft, setSelectedWebsitesDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [urlInput, setUrlInput] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const profileRules = useMemo(
    () => rules.filter(rule => rule.mode === 'profile' && rule.profileId === profileId),
    [rules, profileId]
  )
  const profileConfig = profileRules.find(rule => rule.type === 'profile_config')
  const persistedProfileName = profileConfig?.profileName
    || profileRules.find(rule => rule.profileName)?.profileName
    || profileTitleFallback
  const persistedProfileIcon = profileConfig?.profileIcon
    || profileRules.find(rule => rule.profileIcon)?.profileIcon
    || PROFILE_ICONS[0]
  const profileTitle = profileNameDraft ?? persistedProfileName
  const profileIcon = profileIconDraft ?? persistedProfileIcon

  const persistedSchedule = useMemo(() => {
    const config = profileRules.find(rule => rule.type === 'profile_config')
    const firstRuleWithSchedule = profileRules.find(rule => rule.schedule)
    return normalizeSchedule(config?.schedule || firstRuleWithSchedule?.schedule)
  }, [profileRules])

  const persistedSelectedPrograms = useMemo(() => new Set(
    profileRules
      .filter(rule => rule.type === 'program')
      .map(rule => rule.program?.name)
      .filter(Boolean)
  ), [profileRules])

  const persistedSelectedWebsites = useMemo(() => new Set(
    profileRules
      .filter(rule => rule.type === 'web')
      .map(rule => rule.web?.resolvedPattern || rule.web?.inputUrl)
      .filter(Boolean)
  ), [profileRules])

  const schedule = normalizeSchedule(scheduleDraft || persistedSchedule)
  const selectedPrograms = selectedProgramsDraft || persistedSelectedPrograms
  const selectedWebsites = selectedWebsitesDraft || persistedSelectedWebsites

  const profileProgramRules = useMemo(() => {
    const map = new Map()
    profileRules
      .filter(rule => rule.type === 'program')
      .forEach(rule => map.set(rule.program?.name, rule))
    return map
  }, [profileRules])

  const profileWebsiteRules = useMemo(() => {
    const map = new Map()
    profileRules
      .filter(rule => rule.type === 'web')
      .forEach(rule => map.set(rule.web?.resolvedPattern || rule.web?.inputUrl, rule))
    return map
  }, [profileRules])

  const websites = useMemo(() => {
    const map = new Map()
    rules
      .filter(rule => rule.type === 'web')
      .forEach(rule => {
        const pattern = rule.web?.resolvedPattern || rule.web?.inputUrl
        if (pattern) {
          map.set(pattern, {
            id: pattern,
            inputUrl: rule.web?.inputUrl || pattern,
            resolvedPattern: pattern,
            scope: rule.web?.scope || 'domain'
          })
        }
      })
    selectedWebsites.forEach(pattern => {
      if (!map.has(pattern)) {
        map.set(pattern, {
          id: pattern,
          inputUrl: pattern,
          resolvedPattern: pattern,
          scope: 'domain'
        })
      }
    })
    return Array.from(map.values())
  }, [rules, selectedWebsites])

  const filteredPrograms = useMemo(() => {
    return installedApps
      .filter(app => {
        if (search && !app.name?.toLowerCase().includes(search.toLowerCase())) return false
        if (filter === 'selected' && !selectedPrograms.has(app.name)) return false
        return true
      })
      .sort((left, right) => {
        const leftSelected = selectedPrograms.has(left.name) ? 0 : 1
        const rightSelected = selectedPrograms.has(right.name) ? 0 : 1
        return leftSelected - rightSelected || (left.name || '').localeCompare(right.name || '')
      })
  }, [installedApps, search, filter, selectedPrograms])

  const filteredWebsites = useMemo(() => {
    return websites
      .filter(site => {
        const pattern = site.resolvedPattern || site.inputUrl
        if (search && !pattern.toLowerCase().includes(search.toLowerCase())) return false
        if (filter === 'selected' && !selectedWebsites.has(pattern)) return false
        return true
      })
      .sort((left, right) => {
        const leftPattern = left.resolvedPattern || left.inputUrl
        const rightPattern = right.resolvedPattern || right.inputUrl
        const leftSelected = selectedWebsites.has(leftPattern) ? 0 : 1
        const rightSelected = selectedWebsites.has(rightPattern) ? 0 : 1
        return leftSelected - rightSelected || leftPattern.localeCompare(rightPattern)
      })
  }, [websites, search, filter, selectedWebsites])

  const updateSchedule = (updater) => {
    setScheduleDraft(prevDraft => {
      const prev = normalizeSchedule(prevDraft || schedule)
      return updater(prev)
    })
  }

  const toggleGroupDay = (groupIndex, dayIndex) => {
    updateSchedule(prev => ({
      ...prev,
      groups: prev.groups.map((group, index) => {
        if (index !== groupIndex) return group
        const weekdays = group.weekdays.includes(dayIndex)
          ? group.weekdays.filter(day => day !== dayIndex)
          : [...group.weekdays, dayIndex].sort()
        return { ...group, weekdays }
      })
    }))
  }

  const updateGroupRange = (groupIndex, rangeIndex, patch) => {
    updateSchedule(prev => ({
      ...prev,
      groups: prev.groups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              ranges: group.ranges.map((range, currentRangeIndex) =>
                currentRangeIndex === rangeIndex ? { ...range, ...patch } : range
              )
            }
          : group
      )
    }))
  }

  const addGroupRange = (groupIndex) => {
    updateSchedule(prev => ({
      ...prev,
      groups: prev.groups.map((group, index) =>
        index === groupIndex
          ? { ...group, ranges: [...group.ranges, { timeFrom: '16:00', timeTo: '19:00' }] }
          : group
      )
    }))
  }

  const removeGroupRange = (groupIndex, rangeIndex) => {
    updateSchedule(prev => ({
      ...prev,
      groups: prev.groups.map((group, index) =>
        index === groupIndex
          ? { ...group, ranges: group.ranges.filter((_, currentRangeIndex) => currentRangeIndex !== rangeIndex) }
          : group
      )
    }))
  }

  const addScheduleGroup = () => {
    updateSchedule(prev => ({
      ...prev,
      groups: [...prev.groups, { weekdays: [0, 1, 2, 3, 4], ranges: [{ timeFrom: '10:00', timeTo: '12:00' }] }]
    }))
  }

  const removeScheduleGroup = (groupIndex) => {
    updateSchedule(prev => ({
      ...prev,
      groups: prev.groups.filter((_, index) => index !== groupIndex)
    }))
  }

  const toggleProgram = (name) => {
    setSelectedProgramsDraft(prevDraft => {
      const prev = prevDraft || selectedPrograms
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleWebsite = (pattern) => {
    setSelectedWebsitesDraft(prevDraft => {
      const prev = prevDraft || selectedWebsites
      const next = new Set(prev)
      next.has(pattern) ? next.delete(pattern) : next.add(pattern)
      return next
    })
  }

  const addWebsite = () => {
    if (!urlInput.trim()) {
      setError('Введите сайт')
      return
    }
    const pattern = resolvePattern(urlInput)
    if (!pattern) {
      setError('Не удалось распознать сайт')
      return
    }
    setSelectedWebsitesDraft(prevDraft => new Set([...(prevDraft || selectedWebsites), pattern]))
    setUrlInput('')
    setError('')
  }

  const validateSchedule = () => {
    if (!schedule.groups?.length) return 'Добавьте хотя бы одну группу расписания'
    if (schedule.groups.some(group => group.weekdays.length === 0)) {
      return 'В каждой группе выберите хотя бы один день недели'
    }
    if (schedule.groups.some(group => group.ranges.length === 0)) {
      return 'В каждой группе добавьте хотя бы одно временное окно'
    }
    if (schedule.groups.some(group => group.ranges.some(range => !range.timeFrom || !range.timeTo))) {
      return 'Заполните начало и конец каждого окна'
    }
    return ''
  }

  const handleSave = async () => {
    const validationError = validateSchedule()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    try {
      const programByName = new Map(installedApps.map(app => [app.name, app]))
      await saveProfileRules(profileId, profileTitle, schedule, {
        programs: Array.from(selectedPrograms)
          .map(name => programByName.get(name))
          .filter(Boolean)
          .map(app => ({ name: app.name, path: app.path || '' })),
        websites: Array.from(selectedWebsites).map(pattern => ({
          inputUrl: pattern,
          resolvedPattern: pattern,
          scope: 'domain'
        }))
      }, profileIcon)
      setProfileNameDraft(null)
      setProfileIconDraft(null)
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = selectedPrograms.size + selectedWebsites.size
  const tableLoading = activeSubTab === 'programs' ? appsLoading : rulesLoading
  const actionText = 'Каждая группа дней может разрешать или блокировать выбранное в свои временные окна.'

  return (
    <div className="profile-panel animate-in">
      <div className="profile-schedule-card">
        <div className="profile-schedule-header">
          <div className="profile-schedule-main">
            <div className="profile-title-row">
              <span className="profile-kicker">Расписание</span>
              <span className="profile-desc">{actionText}</span>
            </div>
            <div className="profile-identity-row">
              <input
                className="input profile-name-input"
                value={profileTitle}
                onChange={(event) => setProfileNameDraft(event.target.value)}
                placeholder="Название режима"
              />
              <div className="profile-icon-picker">
                {PROFILE_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`profile-icon-choice ${profileIcon === icon ? 'active' : ''}`}
                    onClick={() => setProfileIconDraft(icon)}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button className="btn btn-primary profile-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? <span className="btn-spinner-sm" /> : 'Сохранить режим'}
          </button>
        </div>

        <div className="profile-schedule-grid profile-schedule-compact">
          <div className="profile-groups">
            {schedule.groups.map((group, groupIndex) => (
              <div className="profile-group-row" key={groupIndex}>
                <div className="profile-group-action">
                  <label className="profile-label">Окна</label>
                  <Select
                    value={group.action}
                    onChange={value => updateSchedule(prev => ({
                      ...prev,
                      groups: prev.groups.map((currentGroup, index) =>
                        index === groupIndex ? { ...currentGroup, action: value } : currentGroup
                      )
                    }))}
                    options={[
                      { value: 'allow', label: 'Разрешать в эти окна' },
                      { value: 'block', label: 'Блокировать в эти окна' }
                    ]}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="profile-group-days">
                  <label className="profile-label">Дни</label>
                  <div className="profile-days">
                    {DAYS.map((day, dayIndex) => (
                      <button
                        key={day}
                        type="button"
                        className={`profile-day ${group.weekdays.includes(dayIndex) ? 'active' : ''}`}
                        onClick={() => toggleGroupDay(groupIndex, dayIndex)}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="profile-group-ranges">
                  <label className="profile-label">Время</label>
                  <div className="profile-ranges">
                    {group.ranges.map((range, rangeIndex) => (
                      <div className="profile-range-row" key={`${groupIndex}-${rangeIndex}-${range.timeFrom}-${range.timeTo}`}>
                        <TimeInput
                          value={range.timeFrom}
                          onChange={timeFrom => updateGroupRange(groupIndex, rangeIndex, { timeFrom })}
                        />
                        <span className="time-sep">—</span>
                        <TimeInput
                          value={range.timeTo}
                          onChange={timeTo => updateGroupRange(groupIndex, rangeIndex, { timeTo })}
                        />
                        <button
                          className="btn btn-sm profile-range-remove"
                          onClick={() => removeGroupRange(groupIndex, rangeIndex)}
                          disabled={group.ranges.length === 1}
                          title="Удалить окно"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button className="btn btn-sm profile-add-range" onClick={() => addGroupRange(groupIndex)}>
                      + Время
                    </button>
                  </div>
                </div>

                <button
                  className="btn btn-sm profile-group-remove"
                  onClick={() => removeScheduleGroup(groupIndex)}
                  disabled={schedule.groups.length === 1}
                  title="Удалить группу дней"
                >
                  ×
                </button>
              </div>
            ))}
            <button className="btn btn-sm profile-add-group" onClick={addScheduleGroup}>
              + Группа дней
            </button>
          </div>
        </div>

        <div className="profile-summary">
          Выбрано: {selectedPrograms.size} программ, {selectedWebsites.size} сайтов.
          {selectedCount === 0 && ' Отметьте цели ниже, чтобы режим начал что-то блокировать.'}
        </div>
        {error && <div className="input-error-msg">{error}</div>}
      </div>

      {activeSubTab === 'web' && (
        <div className="web-add-card">
          <div className="web-add-header">
            <span className="web-add-title">Добавить сайт в режим</span>
            <span className="web-add-hint">Сайт попадёт в список и сразу будет отмечен галочкой</span>
          </div>
          <div className="web-add-form">
            <div className="url-input-wrap">
              <span className="url-prefix">🌐</span>
              <input
                type="text"
                className="input url-input"
                placeholder="youtube.com или vk.com"
                value={urlInput}
                onChange={event => {
                  setUrlInput(event.target.value)
                  setError('')
                }}
                onKeyDown={event => event.key === 'Enter' && addWebsite()}
              />
            </div>
            <button className="btn btn-primary add-btn" onClick={addWebsite}>Добавить</button>
          </div>
        </div>
      )}

      <div className="panel-controls">
        <div className="search-wrap">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            className="input search-input"
            placeholder={activeSubTab === 'programs' ? 'Поиск программы...' : 'Поиск сайта...'}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>

        <Select
          value={filter}
          onChange={setFilter}
          style={{ width: 220 }}
          options={[
            { value: 'all', label: activeSubTab === 'programs' ? 'Все программы' : 'Все сайты' },
            { value: 'selected', label: 'Только выбранные' }
          ]}
        />
      </div>

      <div className="table-container profile-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{activeSubTab === 'programs' ? 'Программа' : 'Сайт'}</th>
              <th style={{ width: 150 }}>В режиме</th>
              <th style={{ width: 180 }}>Сейчас</th>
            </tr>
          </thead>
          <tbody>
            {tableLoading ? (
              <tr>
                <td colSpan={3}>
                  <div className="empty-state">
                    <div className="loading-spinner" />
                    <span className="empty-state-title">Загрузка списка...</span>
                  </div>
                </td>
              </tr>
            ) : activeSubTab === 'programs' ? (
              filteredPrograms.map(app => {
                const rule = profileProgramRules.get(app.name)
                const evaluation = evaluateRule(rule, now)
                const checked = selectedPrograms.has(app.name)
                return (
                  <tr key={app.id || app.name}>
                    <td>
                      <div className="prog-name">{app.name}</div>
                      {app.path
                        ? <div className="prog-path">{app.path}</div>
                        : <div className="prog-path no-path">Путь неизвестен</div>}
                    </td>
                    <td>
                      <label className="custom-checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProgram(app.name)}
                        />
                        <span className="checkmark" />
                      </label>
                    </td>
                    <td>
                      <span className={`profile-status ${evaluation.isBlocked ? 'blocked' : checked ? 'waiting' : ''}`}>
                        {checked ? (evaluation.statusText || 'Сохраните режим') : 'Не выбрано'}
                      </span>
                    </td>
                  </tr>
                )
              })
            ) : (
              filteredWebsites.map(site => {
                const pattern = site.resolvedPattern || site.inputUrl
                const rule = profileWebsiteRules.get(pattern)
                const evaluation = evaluateRule(rule, now)
                const checked = selectedWebsites.has(pattern)
                return (
                  <tr key={pattern}>
                    <td>
                      <div className="prog-name">{pattern}</div>
                    </td>
                    <td>
                      <label className="custom-checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWebsite(pattern)}
                        />
                        <span className="checkmark" />
                      </label>
                    </td>
                    <td>
                      <span className={`profile-status ${evaluation.isBlocked ? 'blocked' : checked ? 'waiting' : ''}`}>
                        {checked ? (evaluation.statusText || 'Сохраните режим') : 'Не выбрано'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
