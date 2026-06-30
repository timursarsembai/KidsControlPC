import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ProgramsPanel from '../ProgramsPanel/ProgramsPanel'
import WebPanel from '../WebPanel/WebPanel'
import PomodoroPanel from '../PomodoroPanel/PomodoroPanel'
import ProfilePanel from '../ProfilePanel/ProfilePanel'
import NotificationsPanel from '../NotificationsPanel/NotificationsPanel'
import PowerPanel from '../PowerPanel/PowerPanel'
import RemindersPanel from '../RemindersPanel/RemindersPanel'
import ScreenshotsPanel from '../ScreenshotsPanel/ScreenshotsPanel'
import LogsPanel from '../LogsPanel/LogsPanel'
import ActivityPanel from '../ActivityPanel/ActivityPanel'
import StoragePanel from '../StoragePanel/StoragePanel'
import ChatPanel from '../ChatPanel/ChatPanel'
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
    selectedDeviceId, devices, setShowSettings, rules,
    toggleProfileMode, updateDeviceSettings
  } = useRulesStore()

  const [updatingDeviceId, setUpdatingDeviceId] = React.useState(null)
  const [noUpdateFound, setNoUpdateFound] = React.useState(false)
  const versionBeforeUpdate = React.useRef(null)
  const updateTimeoutRef = React.useRef(null)

  const selectedDevice = devices.find(d => d.id === selectedDeviceId)
  const lastSeen = selectedDevice?.lastSeen?.toDate?.() || (selectedDevice?.lastSeen ? new Date(selectedDevice.lastSeen.seconds ? selectedDevice.lastSeen.seconds * 1000 : selectedDevice.lastSeen) : null)
  const isAgentOnline = selectedDevice?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000
  const updatingAgent = updatingDeviceId === selectedDeviceId

  const resetUpdateState = (showNoUpdate = false) => {
    setUpdatingDeviceId(null)
    versionBeforeUpdate.current = null
    if (updateTimeoutRef.current) { clearTimeout(updateTimeoutRef.current); updateTimeoutRef.current = null }
    if (showNoUpdate) {
      setNoUpdateFound(true)
      setTimeout(() => setNoUpdateFound(false), 3000)
    }
  }

  const updatingDevice = devices.find(d => d.id === updatingDeviceId)
  React.useEffect(() => {
    if (!updatingDeviceId || !versionBeforeUpdate.current) return
    const currentVersion = updatingDevice?.agentVersion
    if (currentVersion && currentVersion !== versionBeforeUpdate.current) {
      resetUpdateState(false)
    }
  }, [updatingDevice?.agentVersion, updatingDeviceId])

  const handleUpdateAgent = async () => {
    versionBeforeUpdate.current = selectedDevice?.agentVersion || null
    setUpdatingDeviceId(selectedDeviceId)
    setNoUpdateFound(false)
    try {
      await updateDeviceSettings({ forceUpdateRequestedAtMs: Date.now() })
    } catch (e) {
      alert('Ошибка: ' + e.message)
      resetUpdateState(false)
      return
    }
    updateTimeoutRef.current = setTimeout(() => resetUpdateState(true), 5 * 60 * 1000)
  }

  const isProfileTab = activeTab?.startsWith('profile_')
  const profileRule = isProfileTab
    ? rules.find(rule => rule.mode === 'profile' && rule.profileId === activeTab && rule.type === 'profile_config')
      || rules.find(rule => rule.mode === 'profile' && rule.profileId === activeTab)
    : null
  const profileDisabled = !!profileRule?.disabled

  const baseMeta = {
    permanent: { label: t('sidebar.modes.permanent'), icon: '🔒', desc: t('sidebar.modes.permanent_sub') },
    timer:     { label: t('sidebar.modes.timer'), icon: '⏱️', desc: t('sidebar.modes.timer_sub') },
    schedule:  { label: t('sidebar.modes.schedule'), icon: '📅', desc: t('sidebar.modes.schedule_sub') },
    date:      { label: t('sidebar.modes.date'), icon: '📆', desc: t('sidebar.modes.date_sub') },
    monthly_date: { label: t('sidebar.modes.monthly_date', 'Ежемесячно'), icon: '📆', desc: t('sidebar.modes.monthly_date_sub', 'Блокировка по числам месяца') },
    pomodoro:  { label: t('sidebar.modes.pomodoro'), icon: '🍅', desc: t('sidebar.modes.pomodoro_sub') },
    power:     { label: 'Питание', icon: '⚡', desc: 'Выключение, перезагрузка, спящий режим, гибернация' },
    lock_screen: { label: 'Блокировка экрана', icon: '🔒', desc: 'Цвет фона, ПИН-код, заставка' },
    notifications: { label: t('sidebar.notifications', 'Уведомления'), icon: '🔔', desc: t('sidebar.notifications_sub', 'История системных событий') },
    reminders: { label: 'Напоминания', icon: '🔔', desc: 'Будильники и сообщения' },
    screenshots: { label: '\u0421\u043A\u0440\u0438\u043D\u0448\u043E\u0442\u044B', icon: '\uD83D\uDCF8', desc: '\u0421\u043A\u0440\u0438\u043D \u044D\u043A\u0440\u0430\u043D\u0430 \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u0438 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044E' },
    agent_logs: { label: '\u041B\u043E\u0433\u0438 \u0430\u0433\u0435\u043D\u0442\u0430', icon: '\uD83D\uDCCB', desc: '\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430 \u0438 \u043C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433 \u0440\u0430\u0431\u043E\u0442\u044B \u0430\u0433\u0435\u043D\u0442\u0430' },
    activity:  { label: '\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C', icon: '\uD83D\uDCCA', desc: '\u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F, \u0441\u0430\u0439\u0442\u044B \u0438 \u044D\u043A\u0440\u0430\u043D\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F' },
    storage:   { label: '\u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435', icon: '\uD83D\uDCBE', desc: '\u0421\u043A\u0440\u0438\u043D\u0448\u043E\u0442\u044B \u0438 \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0447\u0430\u0442\u043E\u0432' },
    chat:      { label: '\u0427\u0430\u0442', icon: '\uD83D\uDCAC', desc: '\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0441 \u0440\u0435\u0431\u0451\u043D\u043A\u043E\u043C' },
  }[activeTab]
  const meta = isProfileTab
    ? { label: profileRule?.profileName || 'Новый режим', icon: profileRule?.profileIcon || '🧩', desc: 'Свои списки программ, сайтов и расписание' }
    : baseMeta

  if (!selectedDeviceId || !selectedDevice) {
    if (activeTab === 'notifications' || activeTab === 'chat') {
      const Panel = activeTab === 'chat' ? ChatPanel : NotificationsPanel
      return (
        <div className="content-area">
          {activeTab !== 'chat' && (
            <div className="content-header">
              <div className="content-title-row">
                <span className="content-mode-icon">{meta.icon}</span>
                <div>
                  <h1 className="content-title">{meta.label}</h1>
                  <p className="content-desc">{meta.desc}</p>
                </div>
              </div>
            </div>
          )}
          <div className="content-body">
            <Panel />
          </div>
        </div>
      )
    }

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
          {isProfileTab && (
            <button
              className={`profile-mode-toggle-btn ${profileDisabled ? 'off' : 'on'}`}
              onClick={() => toggleProfileMode(activeTab)}
              title={profileDisabled ? 'Режим отключён — нажмите, чтобы включить' : 'Режим включён — нажмите, чтобы отключить'}
              type="button"
              aria-pressed={!profileDisabled}
            >
              <span className="profile-mode-toggle-track">
                <span className="profile-mode-toggle-thumb" />
              </span>
            </button>
          )}
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

        {/* Update agent button — only on agent_logs tab */}
        {activeTab === 'agent_logs' && (
          <button
            className={`content-update-agent-btn ${updatingAgent ? 'updating' : ''} ${noUpdateFound ? 'no-update' : ''} ${!isAgentOnline && !updatingAgent ? 'offline' : ''}`}
            onClick={handleUpdateAgent}
            disabled={updatingAgent || !isAgentOnline}
            type="button"
          >
            {updatingAgent ? (
              <svg className="content-update-agent-spin" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round"/>
              </svg>
            ) : noUpdateFound ? (
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M3 8l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M12.5 7.5a5 5 0 1 1-1.46-3.54M12.5 2v2.5H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {updatingAgent ? 'Обновляется...' : noUpdateFound ? 'Уже актуальная версия' : 'Обновить агента'}
          </button>
        )}

        {/* Sub-tabs */}
        {activeTab !== 'notifications' && activeTab !== 'power' && activeTab !== 'lock_screen' && activeTab !== 'reminders' && activeTab !== 'screenshots' && activeTab !== 'agent_logs' && activeTab !== 'activity' && activeTab !== 'storage' && activeTab !== 'chat' && (
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
        ) : activeTab === 'power' ? (
          <PowerPanel key={`${selectedDeviceId}-power`} mode="power" />
        ) : activeTab === 'lock_screen' ? (
          <PowerPanel key={`${selectedDeviceId}-lock_screen`} mode="lock_screen" />
        ) : activeTab === 'pomodoro' ? (
          <PomodoroPanel key={`${selectedDeviceId}-pomodoro`} />
        ) : isProfileTab ? (
          <ProfilePanel key={`${selectedDeviceId}-${activeTab}`} profileId={activeTab} />
        ) : activeTab === 'reminders' ? (
          <RemindersPanel key={`${selectedDeviceId}-reminders`} />
        ) : activeTab === 'agent_logs' ? (
          <LogsPanel key={`${selectedDeviceId}-agent_logs`} />
        ) : activeTab === 'activity' ? (
          <ActivityPanel key={`${selectedDeviceId}-activity`} />
        ) : activeTab === 'storage' ? (
          <StoragePanel key={`${selectedDeviceId}-storage`} />
        ) : activeTab === 'chat' ? (
          <ChatPanel key="chat" />
        ) : activeTab === 'screenshots' ? (
          <ScreenshotsPanel key={`${selectedDeviceId}-screenshots`} />
        ) : activeSubTab === 'programs' ? (
          <ProgramsPanel key={`${selectedDeviceId}-${activeTab}`} mode={activeTab} />
        ) : (
          <WebPanel      key={`${selectedDeviceId}-${activeTab}`} mode={activeTab} />
        )}
      </div>
    </div>
  )
}

