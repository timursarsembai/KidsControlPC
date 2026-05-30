import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ProgramsPanel from '../ProgramsPanel/ProgramsPanel'
import WebPanel from '../WebPanel/WebPanel'
import PomodoroPanel from '../PomodoroPanel/PomodoroPanel'
import NotificationsPanel from '../NotificationsPanel/NotificationsPanel'
import './ContentArea.css'

// ── Empty state: no devices ───────────────────────────────────────────────────
function NoDeviceState({ onAddDevice }) {
  return (
    <div className="no-device-state">
      <div className="no-device-visual">
        <span className="no-device-icon">🖥️</span>
      </div>
      <h2 className="no-device-title">Нет привязанного устройства</h2>
      <p className="no-device-desc">
        Добавьте ПК ребёнка, чтобы управлять блокировками.<br />
        После привязки здесь появится список программ и управление веб-сайтами.
      </p>
      <button className="btn btn-primary no-device-btn" onClick={onAddDevice}>
        + Добавить устройство
      </button>
      <div className="no-device-steps">
        <div className="no-device-step">
          <span className="step-num">1</span>
          <span>Нажмите кнопку выше или откройте <strong>Настройки → Устройства</strong></span>
        </div>
        <div className="no-device-step">
          <span className="step-num">2</span>
          <span>Сгенерируйте 6-символьный код привязки</span>
        </div>
        <div className="no-device-step">
          <span className="step-num">3</span>
          <span>Запустите агент на ПК ребёнка и введите код</span>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ContentArea() {
  const { t } = useTranslation()
  const {
    activeTab, activeSubTab, setActiveSubTab,
    selectedDeviceId, devices, setShowSettings
  } = useRulesStore()

  const meta = {
    permanent: { label: t('sidebar.modes.permanent'), icon: '🔒', desc: t('sidebar.modes.permanent_sub') },
    timer:     { label: t('sidebar.modes.timer'), icon: '⏱️', desc: t('sidebar.modes.timer_sub') },
    schedule:  { label: t('sidebar.modes.schedule'), icon: '📅', desc: t('sidebar.modes.schedule_sub') },
    date:      { label: t('sidebar.modes.date'), icon: '📆', desc: t('sidebar.modes.date_sub') },
    monthly_date: { label: t('sidebar.modes.monthly_date', 'Ежемесячно'), icon: '📆', desc: t('sidebar.modes.monthly_date_sub', 'Блокировка по числам месяца') },
    pomodoro:  { label: t('sidebar.modes.pomodoro'), icon: '🍅', desc: t('sidebar.modes.pomodoro_sub') },
    notifications: { label: t('sidebar.notifications', 'Уведомления'), icon: '🔔', desc: t('sidebar.notifications_sub', 'История системных событий') },
  }[activeTab]
  const selectedDevice = devices.find(d => d.id === selectedDeviceId)

  if (!selectedDeviceId || !selectedDevice) {
    return (
      <div className="content-area">
        <NoDeviceState onAddDevice={() => setShowSettings(true)} />
      </div>
    )
  }

  return (
    <div className="content-area">
      {/* ── Header ── */}
      <div className="content-header">
        <div className="content-title-row">
          <span className="content-mode-icon">{meta.icon}</span>
          <div>
            <h1 className="content-title">{meta.label}</h1>
            <p className="content-desc">
              {meta.desc}
              <span className="content-device-badge">
                🖥️ {selectedDevice.alias || selectedDevice.hostname || t('sidebar.device_default', 'Устройство')}
              </span>
            </p>
          </div>
        </div>

        {/* Sub-tabs */}
        {activeTab !== 'notifications' && (
          <div className="subtab-bar">
            <button
              id="subtab-programs"
              className={`subtab-btn ${activeSubTab === 'programs' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('programs')}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <rect x="1" y="1" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M4 5h7M4 7.5h5M4 10h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {t('sidebar.programs', 'Программы')}
            </button>
            <button
              id="subtab-web"
              className={`subtab-btn ${activeSubTab === 'web' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('web')}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M7.5 1.5c-2 2-2 9 0 12M7.5 1.5c2 2 2 9 0 12" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M1.5 7.5h12" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
              {t('sidebar.websites', 'Сайты')}
            </button>
          </div>
        )}
      </div>

      {/* ── Panel ── */}
      <div className="content-body">
        {activeTab === 'notifications' ? (
          <NotificationsPanel key={`${selectedDeviceId}-notifications`} />
        ) : activeTab === 'pomodoro' ? (
          <PomodoroPanel key={`${selectedDeviceId}-pomodoro`} />
        ) : activeSubTab === 'programs' ? (
          <ProgramsPanel key={`${selectedDeviceId}-${activeTab}`} mode={activeTab} />
        ) : (
          <WebPanel      key={`${selectedDeviceId}-${activeTab}`} mode={activeTab} />
        )}
      </div>
    </div>
  )
}

