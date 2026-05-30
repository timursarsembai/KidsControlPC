import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './DeviceSidebar.css'

function DeviceItem({ device, isSelected, onClick }) {
  const { t } = useTranslation()
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
    </aside>
  )
}
