import React from 'react'
import { useRulesStore } from '../../stores/useRulesStore'
import './Sidebar.css'

const MODES = [
  {
    id: 'permanent',
    label: 'Постоянная',
    sub: 'Всегда активна',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="2.5" y="6.5" width="10" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M4.5 6.5V5a3 3 0 016 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    id: 'timer',
    label: 'По таймеру',
    sub: 'Обратный отсчёт',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M7.5 5.5v3l2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    id: 'schedule',
    label: 'По расписанию',
    sub: 'Дни недели + время',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1.5" y="2.5" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M5 1v3M10 1v3M1.5 6.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx="5" cy="9.5" r="0.9" fill="currentColor"/>
        <circle cx="7.5" cy="9.5" r="0.9" fill="currentColor"/>
        <circle cx="10" cy="9.5" r="0.9" fill="currentColor"/>
      </svg>
    )
  },
  {
    id: 'date',
    label: 'По дате',
    sub: 'Конкретная дата',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1.5" y="2.5" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M5 1v3M10 1v3M1.5 6.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <path d="M4.5 9.5h6M4.5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    id: 'pomodoro',
    label: 'Интервалы',
    sub: 'Чередование работы и отдыха',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M7.5 4.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 1h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
]

function DeviceItem({ device, isSelected, onClick }) {
  const lastSeen = device.lastSeen?.toDate?.()
  const isOnline = device.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000

  return (
    <button
      className={`device-item ${isSelected ? 'active' : ''}`}
      onClick={onClick}
      title={device.hostname || device.id}
    >
      <span className={`status-dot ${isOnline ? 'active' : 'inactive'}`} />
      <div className="device-item-labels">
        <span className="device-item-name">
          {device.alias || device.hostname || 'Устройство'}
        </span>
        <span className="device-item-sub">
          {isOnline ? 'Онлайн' : 'Оффлайн'}
        </span>
      </div>
      {isSelected && <span className="device-item-check">✓</span>}
    </button>
  )
}

export default function Sidebar() {
  const {
    devices, selectedDeviceId, selectDevice,
    activeTab, setActiveTab,
    showSettings, setShowSettings,
    alerts
  } = useRulesStore()

  const unreadAlerts = alerts?.filter(a => !a.acknowledged).length || 0

  const handleMode = (modeId) => {
    setShowSettings(false)
    setActiveTab(modeId)
  }

  const handleAddDevice = () => {
    setShowSettings(true)
  }

  return (
    <aside className="sidebar">

      {/* ── Back button (when settings are open) ── */}
      {showSettings && (
        <button 
          className="sidebar-back-btn" 
          onClick={() => setShowSettings(false)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Вернуться
        </button>
      )}

      {/* ── Devices section ── */}
      <div className="sidebar-group">
        <div className="sidebar-group-label">Устройства</div>

        {devices.length === 0 ? (
          <div className="sidebar-no-devices">
            <span className="sidebar-no-devices-icon">📡</span>
            <span>Нет устройств</span>
          </div>
        ) : (
          <div className="sidebar-devices">
            {devices.map(device => (
              <DeviceItem
                key={device.id}
                device={device}
                isSelected={selectedDeviceId === device.id}
                onClick={() => { selectDevice(device.id); setShowSettings(false) }}
              />
            ))}
          </div>
        )}

        <button className="sidebar-add-device" onClick={handleAddDevice}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Добавить устройство
        </button>
      </div>

      {/* Divider */}
      <div className="sidebar-divider" />

      {/* ── Block mode nav (only shown when device selected) ── */}
      {selectedDeviceId && !showSettings && (
        <div className="sidebar-group">
          <div className="sidebar-group-label">Режим блокировки</div>
          <nav className="sidebar-nav">
            {MODES.map(mode => (
              <button
                key={mode.id}
                className={`sidebar-item ${activeTab === mode.id ? 'active' : ''}`}
                onClick={() => handleMode(mode.id)}
              >
                <span className="sidebar-icon">{mode.icon}</span>
                <span className="sidebar-labels">
                  <span className="sidebar-label">{mode.label}</span>
                  <span className="sidebar-sub">{mode.sub}</span>
                </span>
                {activeTab === mode.id && <span className="sidebar-active-bar" />}
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* ── Spacer ── */}
      <div className="sidebar-spacer" />

      {/* ── Notifications button ── */}
      {selectedDeviceId && !showSettings && (
        <button
          className={`sidebar-settings-btn ${activeTab === 'notifications' && !showSettings ? 'active' : ''}`}
          onClick={() => handleMode('notifications')}
          style={{ marginBottom: 4 }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5C4.5 1.5 2.5 3.5 2.5 6v3L1.5 11h11l-1-2V6c0-2.5-2-4.5-4.5-4.5zM5 12h4a2 2 0 01-4 0z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Уведомления
          </span>
          {unreadAlerts > 0 && (
            <span style={{
              background: 'var(--accent)', color: '#fff', fontSize: 10, padding: '2px 6px',
              borderRadius: '10px', fontWeight: 700, lineHeight: 1
            }}>
              {unreadAlerts}
            </span>
          )}
        </button>
      )}

      {/* ── Settings button ── */}
      <button
        className={`sidebar-settings-btn ${showSettings ? 'active' : ''}`}
        onClick={() => setShowSettings(!showSettings)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5.5 1.5h3M7 1.5v1.2A4.5 4.5 0 0110.8 5l1-.6 1.5 2.6-1 .6a4.5 4.5 0 010 1.8l1 .6L11.8 12l-1-.6A4.5 4.5 0 018.5 13v1.5h-3V13a4.5 4.5 0 01-2.3-1.6l-1 .6L.7 9.4l1-.6a4.5 4.5 0 010-1.8l-1-.6L2.2 4l1 .6A4.5 4.5 0 015.5 2.7V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <circle cx="7" cy="7" r="1.7" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        Настройки
      </button>
    </aside>
  )
}
