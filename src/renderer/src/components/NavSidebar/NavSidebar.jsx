import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ProfileSection from './ProfileSection'
import './NavSidebar.css'

const MODES = [
  { id: 'permanent', icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2.5" y="6.5" width="10" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M4.5 6.5V5a3 3 0 016 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
    ) },
  { id: 'timer', icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M7.5 5.5v3l2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
    ) },
  { id: 'schedule', icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="2.5" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M10 1v3M1.5 6.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="5" cy="9.5" r="0.9" fill="currentColor"/><circle cx="7.5" cy="9.5" r="0.9" fill="currentColor"/><circle cx="10" cy="9.5" r="0.9" fill="currentColor"/></svg>
    ) },
  { id: 'date', icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="2.5" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M10 1v3M1.5 6.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M4.5 9.5h6M4.5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
    ) },
  { id: 'monthly_date', icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="2.5" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M10 1v3M1.5 6.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"/></svg>
    ) },
  { id: 'pomodoro', icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M7.5 4.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 1h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
    ) },
]

const MODE_TAB_IDS = new Set(MODES.map((m) => m.id))
const DEVICE_TAB_IDS = new Set(['power', 'lock_screen', 'reminders', 'screenshots', 'agent_logs'])

export default function Sidebar() {
  const { t } = useTranslation()
  const {
    selectedDeviceId,
    activeTab, setActiveTab,
    activeSubTab, setActiveSubTab,
    showSettings, setShowSettings,
    rules, addProfileMode, deleteProfileMode
  } = useRulesStore()

  const [expandedSections, setExpandedSections] = React.useState({
    profiles: true,
    device: true,
    programs: false,
    websites: false
  })
  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const handleMode = (modeId, subTab = null, sectionToKeepOpen = null) => {
    setShowSettings(false)
    if (subTab) setActiveSubTab(subTab)
    setActiveTab(modeId)
    if (sectionToKeepOpen) {
      setExpandedSections((prev) => ({ ...prev, [sectionToKeepOpen]: true }))
    }
  }

  const isDeviceSectionActive = DEVICE_TAB_IDS.has(activeTab)
  const isProfilesSectionActive = activeTab?.startsWith('profile_')
  const isProgramsSectionActive = MODE_TAB_IDS.has(activeTab) && activeSubTab === 'programs'
  const isWebsitesSectionActive = MODE_TAB_IDS.has(activeTab) && activeSubTab === 'web'

  return (
    <aside className="nav-sidebar">
      {!showSettings && (
        <button
          className={`nav-sidebar-item nav-sidebar-chat-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => handleMode('chat')}
        >
          <span className="nav-sidebar-icon">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M2 2.5h11a.5.5 0 01.5.5v7a.5.5 0 01-.5.5H5l-3 2.5V3a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </span>
          <span className="nav-sidebar-labels">
            <span className="nav-sidebar-label">Чат</span>
            <span className="nav-sidebar-sub">Сообщения с детьми</span>
          </span>
          {activeTab === 'chat' && <span className="nav-sidebar-active-bar" />}
        </button>
      )}

      {selectedDeviceId && !showSettings && (
        <>
          <ProfileSection
            activeTab={activeTab}
            addProfileMode={addProfileMode}
            deleteProfileMode={deleteProfileMode}
            expanded={expandedSections.profiles}
            handleMode={handleMode}
            isActive={isProfilesSectionActive}
            onToggle={() => toggleSection('profiles')}
            rules={rules}
          />

          <div className="nav-sidebar-divider" />

          <div className="nav-sidebar-group nav-sidebar-dropdown">
            <button
              className={`nav-sidebar-dropdown-toggle ${expandedSections.device ? 'open' : ''} ${isDeviceSectionActive ? 'active' : ''}`}
              onClick={() => toggleSection('device')}
              aria-expanded={expandedSections.device}
              aria-controls="nav-section-device"
              type="button"
            >
              <span className="nav-sidebar-group-label">Управление устройством</span>
              <span className="nav-sidebar-dropdown-chevron" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3.5 4.75L6 7.25L8.5 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
            {expandedSections.device && (
              <nav id="nav-section-device" className="nav-sidebar-nav">
                <button
                  className={`nav-sidebar-item ${activeTab === 'power' ? 'active' : ''}`}
                  onClick={() => handleMode('power', null, 'device')}
                >
                  <span className="nav-sidebar-icon">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                      <path d="M7.5 1.5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      <path d="M4.5 3.3A5.5 5.5 0 107.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <span className="nav-sidebar-labels">
                    <span className="nav-sidebar-label">Питание</span>
                    <span className="nav-sidebar-sub">Выключение, перезагрузка</span>
                  </span>
                  {activeTab === 'power' && <span className="nav-sidebar-active-bar" />}
                </button>

                <button
                  className={`nav-sidebar-item ${activeTab === 'lock_screen' ? 'active' : ''}`}
                  onClick={() => handleMode('lock_screen', null, 'device')}
                >
                  <span className="nav-sidebar-icon">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                      <rect x="2.5" y="7" width="10" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M4.5 7V5.5a3 3 0 016 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="7.5" cy="10" r="0.8" fill="currentColor"/>
                    </svg>
                  </span>
                  <span className="nav-sidebar-labels">
                    <span className="nav-sidebar-label">Блокировка экрана</span>
                    <span className="nav-sidebar-sub">Цвет, ПИН, заставка</span>
                  </span>
                  {activeTab === 'lock_screen' && <span className="nav-sidebar-active-bar" />}
                </button>

                <button
                  className={`nav-sidebar-item ${activeTab === 'reminders' ? 'active' : ''}`}
                  onClick={() => handleMode('reminders', null, 'device')}
                >
                  <span className="nav-sidebar-icon">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                      <path d="M7.5 1.5C5 1.5 3 3.5 3 6v3.5L2 11h11l-1-1.5V6c0-2.5-2-4.5-4.5-4.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <span className="nav-sidebar-labels">
                    <span className="nav-sidebar-label">Напоминания</span>
                    <span className="nav-sidebar-sub">Сообщения по расписанию</span>
                  </span>
                  {activeTab === 'reminders' && <span className="nav-sidebar-active-bar" />}
                </button>

                <button
                  className={`nav-sidebar-item ${activeTab === 'screenshots' ? 'active' : ''}`}
                  onClick={() => handleMode('screenshots', null, 'device')}
                >
                  <span className="nav-sidebar-icon">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                      <rect x="2" y="4.5" width="11" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M5.2 4.5l.8-1.8h3l.8 1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="7.5" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                  </span>
                  <span className="nav-sidebar-labels">
                    <span className="nav-sidebar-label">{'\u0421\u043A\u0440\u0438\u043D\u0448\u043E\u0442\u044B'}</span>
                    <span className="nav-sidebar-sub">{'\u041F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u0438 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044E'}</span>
                  </span>
                  {activeTab === 'screenshots' && <span className="nav-sidebar-active-bar" />}
                </button>

                <button
                  className={`nav-sidebar-item ${activeTab === 'agent_logs' ? 'active' : ''}`}
                  onClick={() => handleMode('agent_logs', null, 'device')}
                >
                  <span className="nav-sidebar-icon">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                      <rect x="2" y="1.5" width="11" height="12" rx="1.3" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M4.5 5h6M4.5 7.5h6M4.5 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <span className="nav-sidebar-labels">
                    <span className="nav-sidebar-label">\u041B\u043E\u0433\u0438 \u0430\u0433\u0435\u043D\u0442\u0430</span>
                    <span className="nav-sidebar-sub">\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430 \u0438 \u043C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433</span>
                  </span>
                  {activeTab === 'agent_logs' && <span className="nav-sidebar-active-bar" />}
                </button>
              </nav>
            )}
          </div>

          <div className="nav-sidebar-divider" />

          <div className="nav-sidebar-group nav-sidebar-dropdown">
            <button
              className={`nav-sidebar-dropdown-toggle ${expandedSections.programs ? 'open' : ''} ${isProgramsSectionActive ? 'active' : ''}`}
              onClick={() => toggleSection('programs')}
              aria-expanded={expandedSections.programs}
              aria-controls="nav-section-programs"
              type="button"
            >
              <span className="nav-sidebar-group-label">Блокировка программ</span>
              <span className="nav-sidebar-dropdown-chevron" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3.5 4.75L6 7.25L8.5 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
            {expandedSections.programs && (
              <nav id="nav-section-programs" className="nav-sidebar-nav">
                {MODES.map((mode) => (
                  <button
                    key={`program-${mode.id}`}
                    className={`nav-sidebar-item ${activeTab === mode.id && activeSubTab === 'programs' ? 'active' : ''}`}
                    onClick={() => handleMode(mode.id, 'programs', 'programs')}
                  >
                    <span className="nav-sidebar-icon">{mode.icon}</span>
                    <span className="nav-sidebar-labels">
                      <span className="nav-sidebar-label">{t(`sidebar.modes.${mode.id}`)}</span>
                      <span className="nav-sidebar-sub">{t(`sidebar.modes.${mode.id}_sub`)}</span>
                    </span>
                    {activeTab === mode.id && activeSubTab === 'programs' && <span className="nav-sidebar-active-bar" />}
                  </button>
                ))}
              </nav>
            )}
          </div>

          <div className="nav-sidebar-divider" />

          <div className="nav-sidebar-group nav-sidebar-dropdown">
            <button
              className={`nav-sidebar-dropdown-toggle ${expandedSections.websites ? 'open' : ''} ${isWebsitesSectionActive ? 'active' : ''}`}
              onClick={() => toggleSection('websites')}
              aria-expanded={expandedSections.websites}
              aria-controls="nav-section-websites"
              type="button"
            >
              <span className="nav-sidebar-group-label">Блокировка сайтов</span>
              <span className="nav-sidebar-dropdown-chevron" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3.5 4.75L6 7.25L8.5 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
            {expandedSections.websites && (
              <nav id="nav-section-websites" className="nav-sidebar-nav">
                {MODES.map((mode) => (
                  <button
                    key={`web-${mode.id}`}
                    className={`nav-sidebar-item ${activeTab === mode.id && activeSubTab === 'web' ? 'active' : ''}`}
                    onClick={() => handleMode(mode.id, 'web', 'websites')}
                  >
                    <span className="nav-sidebar-icon">{mode.icon}</span>
                    <span className="nav-sidebar-labels">
                      <span className="nav-sidebar-label">{t(`sidebar.modes.${mode.id}`)}</span>
                      <span className="nav-sidebar-sub">{t(`sidebar.modes.${mode.id}_sub`)}</span>
                    </span>
                    {activeTab === mode.id && activeSubTab === 'web' && <span className="nav-sidebar-active-bar" />}
                  </button>
                ))}
              </nav>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
