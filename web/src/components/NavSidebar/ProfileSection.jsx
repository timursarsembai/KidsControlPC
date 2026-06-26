import React from 'react'

const PROFILE_ICONS = ['🧩', '🎮', '📚', '📖', '🌙', '☀️', '🎧', '🎨', '💻', '🧠', '⚽', '🍿']

export default function ProfileSection({
  activeTab,
  addProfileMode,
  deleteProfileMode,
  toggleProfileMode,
  expanded,
  handleMode,
  isActive,
  onToggle,
  rules
}) {
  const [showCreateProfile, setShowCreateProfile] = React.useState(false)
  const [newProfileName, setNewProfileName] = React.useState('')
  const [newProfileIcon, setNewProfileIcon] = React.useState(PROFILE_ICONS[0])
  const [profileDeleteConfirmId, setProfileDeleteConfirmId] = React.useState(null)

  const profileModes = React.useMemo(() => {
    const profiles = new Map()
    rules
      .filter(rule => rule.mode === 'profile' && rule.profileId)
      .forEach(rule => {
        if (!profiles.has(rule.profileId) || rule.type === 'profile_config') {
          profiles.set(rule.profileId, {
            id: rule.profileId,
            label: rule.profileName || 'Новый режим',
            sub: 'Свои списки и расписание',
            icon: rule.profileIcon || '🧩',
            createdAt: rule.createdAt,
            disabled: rule.type === 'profile_config' ? !!rule.disabled : (profiles.get(rule.profileId)?.disabled ?? false)
          })
        }
      })

    return Array.from(profiles.values()).sort((left, right) => {
      const leftTime = left.createdAt?.toMillis?.() || 0
      const rightTime = right.createdAt?.toMillis?.() || 0
      return leftTime - rightTime
    })
  }, [rules])

  const handleAddProfile = async () => {
    const profileId = await addProfileMode(newProfileName, newProfileIcon)
    if (profileId) handleMode(profileId, 'programs', 'profiles')
    setNewProfileName('')
    setNewProfileIcon(PROFILE_ICONS[0])
    setShowCreateProfile(false)
  }

  const requestDeleteProfile = (event, mode) => {
    event.stopPropagation()
    setProfileDeleteConfirmId(mode.id)
  }

  const handleDeleteProfile = async (event, mode) => {
    event.stopPropagation()
    await deleteProfileMode(mode.id)
    setProfileDeleteConfirmId(null)
  }

  return (
    <div className="nav-sidebar-group nav-sidebar-dropdown">
      <button
        className={`nav-sidebar-dropdown-toggle ${expanded ? 'open' : ''} ${isActive ? 'active' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="nav-section-profiles"
        type="button"
      >
        <span className="nav-sidebar-group-label">Режимы</span>
        <span className="nav-sidebar-dropdown-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3.5 4.75L6 7.25L8.5 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>
      {expanded && (
        <nav id="nav-section-profiles" className="nav-sidebar-nav">
          {profileModes.map((mode) => (
            <button
              key={mode.id}
              className={`nav-sidebar-item ${activeTab === mode.id ? 'active' : ''} ${mode.disabled ? 'profile-disabled' : ''}`}
              onClick={() => handleMode(mode.id, 'programs', 'profiles')}
            >
              <span className="nav-sidebar-icon">{mode.icon}</span>
              <span className="nav-sidebar-labels">
                <span className="nav-sidebar-label">{mode.label}</span>
                <span className="nav-sidebar-sub">{mode.sub}</span>
              </span>
              {profileDeleteConfirmId === mode.id ? (
                <span className="nav-sidebar-delete-confirm" onClick={(event) => event.stopPropagation()}>
                  <span
                    role="button"
                    tabIndex={0}
                    className="nav-sidebar-delete-confirm-yes"
                    onClick={(event) => handleDeleteProfile(event, mode)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') handleDeleteProfile(event, mode)
                    }}
                  >
                    Да
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="nav-sidebar-delete-confirm-no"
                    onClick={(event) => {
                      event.stopPropagation()
                      setProfileDeleteConfirmId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation()
                        setProfileDeleteConfirmId(null)
                      }
                    }}
                  >
                    Нет
                  </span>
                </span>
              ) : (
                <span
                  className="nav-sidebar-delete-profile"
                  role="button"
                  tabIndex={0}
                  title="Удалить режим"
                  onClick={(event) => requestDeleteProfile(event, mode)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') requestDeleteProfile(event, mode)
                  }}
                >
                  ×
                </span>
              )}
              {activeTab === mode.id && <span className="nav-sidebar-active-bar" />}
            </button>
          ))}
          <button
            className="nav-sidebar-item nav-sidebar-add-profile"
            onClick={() => setShowCreateProfile((value) => !value)}
            type="button"
          >
            <span className="nav-sidebar-icon">＋</span>
            <span className="nav-sidebar-labels">
              <span className="nav-sidebar-label">Добавить режим</span>
              <span className="nav-sidebar-sub">Новый список и расписание</span>
            </span>
          </button>
          {showCreateProfile && (
            <div className="nav-sidebar-create-profile">
              <input
                className="input nav-sidebar-profile-input"
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleAddProfile()}
                placeholder="Название режима"
                autoFocus
              />
              <div className="nav-sidebar-icon-grid">
                {PROFILE_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`nav-sidebar-icon-choice ${newProfileIcon === icon ? 'active' : ''}`}
                    onClick={() => setNewProfileIcon(icon)}
                  >
                    {icon}
                  </button>
                ))}
              </div>
              <div className="nav-sidebar-create-actions">
                <button className="btn btn-sm btn-primary" onClick={handleAddProfile}>
                  Создать
                </button>
                <button className="btn btn-sm" onClick={() => setShowCreateProfile(false)}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </nav>
      )}
    </div>
  )
}
