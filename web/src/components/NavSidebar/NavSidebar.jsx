import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
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


export default function Sidebar() {
  const { t } = useTranslation()
  const {
    selectedDeviceId,
    activeTab, setActiveTab,
    showSettings, setShowSettings,
    alerts
  } = useRulesStore()

  const unreadAlerts = alerts?.filter(a => !a.acknowledged).length || 0

  const handleMode = (modeId) => {
    setShowSettings(false)
    setActiveTab(modeId)
  }

  return (
    <aside className="nav-sidebar">

      {/* ── Block mode nav (only shown when device selected) ── */}
      {selectedDeviceId && !showSettings && (
        <div className="nav-sidebar-group">
          <div className="nav-sidebar-group-label">Управление ПО и сайтами</div>
          <nav className="nav-sidebar-nav">
            {MODES.map(mode => (
              <button
                key={mode.id}
                className={`nav-sidebar-item ${activeTab === mode.id ? 'active' : ''}`}
                onClick={() => handleMode(mode.id)}
              >
                <span className="nav-sidebar-icon">{mode.icon}</span>
                <span className="nav-sidebar-labels">
                  <span className="nav-sidebar-label">{t(`sidebar.modes.${mode.id}`)}</span>
                  <span className="nav-sidebar-sub">{t(`sidebar.modes.${mode.id}_sub`)}</span>
                </span>
                {activeTab === mode.id && <span className="nav-sidebar-active-bar" />}
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* ── Divider ── */}
      {selectedDeviceId && !showSettings && <div className="nav-sidebar-divider" />}

      {/* ── Device control group ── */}
      {selectedDeviceId && !showSettings && (
        <div className="nav-sidebar-group">
          <div className="nav-sidebar-group-label">Управление устройством</div>
          <nav className="nav-sidebar-nav">

            {/* Power */}
            <button
              className={`nav-sidebar-item ${activeTab === 'power' ? 'active' : ''}`}
              onClick={() => handleMode('power')}
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

            {/* Lock screen */}
            <button
              className={`nav-sidebar-item ${activeTab === 'lock_screen' ? 'active' : ''}`}
              onClick={() => handleMode('lock_screen')}
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

            {/* Reminders */}
            <button
              className={`nav-sidebar-item ${activeTab === 'reminders' ? 'active' : ''}`}
              onClick={() => handleMode('reminders')}
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


          </nav>
        </div>
      )}
    </aside>
  )
}
