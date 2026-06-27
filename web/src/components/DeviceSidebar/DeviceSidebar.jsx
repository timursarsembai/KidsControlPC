import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './DeviceSidebar.css'

function formatStorageBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' ГБ'
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' МБ'
  return (bytes / 1024).toFixed(0) + ' КБ'
}

const ORDER_KEY = 'kc_device_order'

function loadOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || [] } catch { return [] }
}
function saveOrder(ids) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)) } catch {}
}

function sortDevices(devices) {
  const saved = loadOrder()
  if (saved.length === 0) {
    // No manual order yet — sort alphabetically
    return [...devices].sort((a, b) => {
      const na = (a.alias || a.hostname || '').toLowerCase()
      const nb = (b.alias || b.hostname || '').toLowerCase()
      return na.localeCompare(nb, 'ru')
    })
  }
  // Apply saved order; append any new devices (alphabetically) at the end
  const ordered = []
  for (const id of saved) {
    const d = devices.find(x => x.id === id)
    if (d) ordered.push(d)
  }
  const rest = [...devices]
    .filter(d => !saved.includes(d.id))
    .sort((a, b) => (a.alias || a.hostname || '').toLowerCase().localeCompare((b.alias || b.hostname || '').toLowerCase(), 'ru'))
  return [...ordered, ...rest]
}

function DeviceItem({ device, isSelected, onClick, onDragStart, onDragEnter, onDragEnd, isDragging, isOver }) {
  const { t } = useTranslation()
  const [now, setNow] = React.useState(Date.now())

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  const lastSeen = device.lastSeen?.toDate?.()
  const isOnline = device.status !== 'offline' && lastSeen && (now - lastSeen.getTime()) < 2 * 60 * 1000

  return (
    <button
      className={`device-item ${isSelected ? 'active' : ''} ${isDragging ? 'dnd-dragging' : ''} ${isOver ? 'dnd-over' : ''}`}
      onClick={onClick}
      title={device.hostname || device.id}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={e => e.preventDefault()}
      onDragEnd={onDragEnd}
    >
      <span
        className="device-drag-handle"
        title="Перетащите для изменения порядка"
      >
        ⠿
      </span>
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

export default function DeviceSidebar({ isMobileOpen = false, onMobileNavigate }) {
  const { devices, selectedDeviceId, selectDevice, showSettings, setShowSettings, activeTab, setActiveTab, alerts, storageUsedBytes, storageQuotaBytes } = useRulesStore()

  const [orderedDevices, setOrderedDevices] = React.useState([])
  const [dragIdx, setDragIdx] = React.useState(null)
  const [overIdx, setOverIdx] = React.useState(null)

  React.useEffect(() => {
    setOrderedDevices(sortDevices(devices))
  }, [devices])

  const handleDragStart = (idx) => {
    setDragIdx(idx)
  }

  const handleDragEnter = (idx) => {
    if (idx === dragIdx) return
    setOverIdx(idx)
    setOrderedDevices(prev => {
      const next = [...prev]
      const [item] = next.splice(dragIdx, 1)
      next.splice(idx, 0, item)
      setDragIdx(idx)
      return next
    })
  }

  const handleDragEnd = () => {
    saveOrder(orderedDevices.map(d => d.id))
    setDragIdx(null)
    setOverIdx(null)
  }

  const handleAddDevice = () => {
    setShowSettings(true)
    onMobileNavigate?.()
  }

  const unreadAlerts = alerts?.filter(a => !a.acknowledged).length || 0

  return (
    <aside className={`device-sidebar ${isMobileOpen ? 'mobile-open' : ''}`}>
      {showSettings && (
        <button
          className="device-sidebar-back-btn"
          onClick={() => { setShowSettings(false); onMobileNavigate?.() }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Вернуться
        </button>
      )}

      <div className="device-sidebar-group">
        <div className="device-sidebar-group-label">Устройства</div>

        {orderedDevices.length === 0 ? (
          <div className="device-sidebar-no-devices">
            <span className="device-sidebar-no-devices-icon">📡</span>
            <span>Нет устройств</span>
          </div>
        ) : (
          <div className="device-sidebar-devices">
            {orderedDevices.map((device, idx) => (
              <DeviceItem
                key={device.id}
                device={device}
                isSelected={selectedDeviceId === device.id && !showSettings && activeTab !== 'notifications'}
                onClick={() => { selectDevice(device.id); setShowSettings(false); if (activeTab === 'notifications') setActiveTab('permanent'); onMobileNavigate?.() }}
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                isDragging={dragIdx === idx}
                isOver={overIdx === idx}
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

      <div style={{ flex: 1 }} />

      <button
        className={`device-sidebar-settings-btn ${activeTab === 'activity' && !showSettings ? 'active' : ''}`}
        onClick={() => { setActiveTab('activity'); setShowSettings(false); onMobileNavigate?.() }}
      >
        <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
          <path d="M1 11l3.5-4 3 3 3.5-5 3 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Активность
      </button>

      <button
        className={`device-sidebar-settings-btn ${activeTab === 'storage' && !showSettings ? 'active' : ''}`}
        onClick={() => { setActiveTab('storage'); setShowSettings(false); onMobileNavigate?.() }}
      >
        <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
          <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M1.5 6.5h12" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5 9.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        Хранилище
      </button>

      <button
        className={`device-sidebar-settings-btn ${activeTab === 'notifications' && !showSettings ? 'active' : ''}`}
        onClick={() => { setActiveTab('notifications'); setShowSettings(false); onMobileNavigate?.() }}
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

      <button
        className={`device-sidebar-settings-btn ${showSettings ? 'active' : ''}`}
        onClick={() => { setShowSettings(!showSettings); onMobileNavigate?.() }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5.5 1.5h3M7 1.5v1.2A4.5 4.5 0 0110.8 5l1-.6 1.5 2.6-1 .6a4.5 4.5 0 010 1.8l1 .6L11.8 12l-1-.6A4.5 4.5 0 018.5 13v1.5h-3V13a4.5 4.5 0 01-2.3-1.6l-1 .6L.7 9.4l1-.6a4.5 4.5 0 010-1.8l-1-.6L2.2 4l1 .6A4.5 4.5 0 015.5 2.7V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <circle cx="7" cy="7" r="1.7" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        Настройки
      </button>

      {(() => {
        const pct = storageQuotaBytes > 0 ? Math.min(100, (storageUsedBytes / storageQuotaBytes) * 100) : 0
        const color = pct >= 90 ? 'var(--danger, #ef4444)' : pct >= 70 ? '#f59e0b' : 'var(--accent)'
        return (
          <button
            className="device-storage-bar device-storage-bar--clickable"
            onClick={() => { setActiveTab('storage'); setShowSettings(false); onMobileNavigate?.() }}
            title="Открыть хранилище"
            type="button"
          >
            <div className="device-storage-bar-row">
              <span className="device-storage-bar-label">Хранилище</span>
              <span className="device-storage-bar-nums">{formatStorageBytes(storageUsedBytes)} / {formatStorageBytes(storageQuotaBytes)}</span>
            </div>
            <div className="device-storage-bar-track">
              <div className="device-storage-bar-fill" style={{ width: pct + '%', background: color }} />
            </div>
          </button>
        )
      })()}

      <div style={{ textAlign: 'center', color: 'var(--text-disabled)', fontSize: '9px', marginTop: '4px', marginBottom: '8px' }}>
        v{__APP_VERSION__}
      </div>
    </aside>
  )
}
