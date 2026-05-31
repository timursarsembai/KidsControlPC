import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './DeviceSidebar.css'

function DeviceItem({ device, isSelected, onClick }) {
  const { t } = useTranslation()
  const [now, setNow] = React.useState(Date.now())
  
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000) // Update every 15 seconds
    return () => clearInterval(timer)
  }, [])

  const lastSeen = device.lastSeen?.toDate?.()
  const isOnline = device.status !== 'offline' && lastSeen && (now - lastSeen.getTime()) < 2 * 60 * 1000

  return (
    <button
      className={`device-item ${isSelected ? 'active' : ''}`}
      onClick={onClick}
      title={device.hostname || device.id}
    >
      <span className={`status-dot ${isOnline ? 'active' : 'inactive'}`} />
      <div className="device-item-labels">
        <span className="device-item-name">
          {device.alias || device.hostname || t('sidebar.device_default')}
        </span>
        <span className="device-item-sub">
          {isOnline ? t('sidebar.device_online') : t('sidebar.device_offline')}
        </span>
      </div>
      {isSelected && <span className="device-item-check">✓</span>}
    </button>
  )
}

export default function DeviceSidebar() {
  const { devices, selectedDeviceId, selectDevice, showSettings, setShowSettings, activeTab, setActiveTab, alerts } = useRulesStore()

  const handleAddDevice = () => {
    setShowSettings(true)
  }

  const unreadAlerts = alerts?.filter(a => !a.acknowledged).length || 0

  return (
    <aside className="device-sidebar">
      {/* ── Back button (when settings are open) ── */}
      {showSettings && (
        <button 
          className="device-sidebar-back-btn" 
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
      <div className="device-sidebar-group">
        <div className="device-sidebar-group-label">Устройства</div>

        {devices.length === 0 ? (
          <div className="device-sidebar-no-devices">
            <span className="device-sidebar-no-devices-icon">📡</span>
            <span>Нет устройств</span>
          </div>
        ) : (
          <div className="device-sidebar-devices">
            {devices.map(device => (
              <DeviceItem
                key={device.id}
                device={device}
                isSelected={selectedDeviceId === device.id && !showSettings && activeTab !== 'notifications'}
                onClick={() => { selectDevice(device.id); setShowSettings(false); if(activeTab === 'notifications') setActiveTab('permanent'); }}
              />
            ))}
          </div>
        )}

        <button className="device-sidebar-add-device" onClick={handleAddDevice}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Добавить устройство
        </button>
      </div>

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── Notifications button ── */}
      <button
        className={`device-sidebar-settings-btn ${activeTab === 'notifications' && !showSettings ? 'active' : ''}`}
        onClick={() => { setActiveTab('notifications'); setShowSettings(false); }}
      >
        <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
          <path d="M7.5 1.5C5 1.5 3 3.5 3 6v3.5L2 11h11l-1-1.5V6c0-2.5-2-4.5-4.5-4.5zM5.5 12.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Уведомления
        {unreadAlerts > 0 && (
          <span style={{
            background: 'var(--accent)', color: '#fff', fontSize: 10, padding: '2px 6px',
            borderRadius: '10px', fontWeight: 700, lineHeight: 1, marginLeft: 'auto'
          }}>
            {unreadAlerts}
          </span>
        )}
      </button>

      {/* ── Settings button ── */}
      <button
        className={`device-sidebar-settings-btn ${showSettings ? 'active' : ''}`}
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
