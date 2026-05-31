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
  const { devices, selectedDeviceId, selectDevice, showSettings, setShowSettings } = useRulesStore()

  const handleAddDevice = () => {
    setShowSettings(true)
  }

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
                isSelected={selectedDeviceId === device.id}
                onClick={() => { selectDevice(device.id); setShowSettings(false) }}
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
