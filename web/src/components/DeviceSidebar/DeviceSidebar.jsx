import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { supportsChildren } from '@kidscontrol/shared/data/children'
import { withCount } from '@kidscontrol/shared/utils/plural'
import ChildDialog from './ChildDialog'
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

function DeviceItem({ device, isSelected, onClick, onDragStart, onDragEnter, onDragEnd, isDragging, isOver, onMove, childProfiles = [] }) {
  const { t } = useTranslation()
  const [now, setNow] = React.useState(Date.now())

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  const lastSeen = device.lastSeen?.toDate?.()
  const isOnline = device.status !== 'offline' && lastSeen && (now - lastSeen.getTime()) < 2 * 60 * 1000

  return (
    <div className={`device-item-row ${isSelected ? 'active' : ''}`}>
    <span
      role="button"
      tabIndex={0}
      className={`device-item ${isSelected ? 'active' : ''} ${isDragging ? 'dnd-dragging' : ''} ${isOver ? 'dnd-over' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
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
    </span>
    {onMove && (
      // Перенос выбором, а не перетаскиванием: перетащить устройство в
      // соседний профиль слишком легко случайно, а последствие — ребёнок
      // остаётся без присмотра, и заметить это не по чему.
      <select
        className="device-item-move"
        value={device.childId ?? ''}
        title="Переместить в другой профиль"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMove(device.id, e.target.value || null)}
      >
        {childProfiles.map(c => (
          <option key={c.id} value={c.id}>{c.avatar} {c.name}</option>
        ))}
        <option value="">Без профиля</option>
      </select>
    )}
    </div>
  )
}

/**
 * Список устройств одного профиля, с перетаскиванием внутри профиля.
 *
 * Порядок внутри группы — своё состояние: индексы перетаскивания локальные,
 * иначе при переносе между профилями они указывали бы не на те строки.
 */
function DeviceGroup({ devices, selectedDeviceId, showSettings, activeTab, onSelect, onReorder, onMove, childProfiles }) {
  const [ordered, setOrdered] = React.useState(devices)
  const [dragIdx, setDragIdx] = React.useState(null)
  const [overIdx, setOverIdx] = React.useState(null)

  React.useEffect(() => { setOrdered(devices) }, [devices])

  return (
    <div className="device-sidebar-devices">
      {ordered.map((device, idx) => (
        <DeviceItem
          key={device.id}
          device={device}
          isSelected={selectedDeviceId === device.id && !showSettings && activeTab !== 'notifications'}
          onClick={() => onSelect(device.id)}
          onDragStart={() => setDragIdx(idx)}
          onDragEnter={() => {
            if (idx === dragIdx || dragIdx === null) return
            setOverIdx(idx)
            setOrdered(prev => {
              const next = [...prev]
              const [item] = next.splice(dragIdx, 1)
              next.splice(idx, 0, item)
              setDragIdx(idx)
              return next
            })
          }}
          onDragEnd={() => { onReorder(ordered); setDragIdx(null); setOverIdx(null) }}
          isDragging={dragIdx === idx}
          isOver={overIdx === idx}
          onMove={onMove}
          childProfiles={childProfiles}
        />
      ))}
    </div>
  )
}

export default function DeviceSidebar({ isMobileOpen = false, onMobileNavigate }) {
  const {
    devices, selectedDeviceId, selectDevice, showSettings, setShowSettings,
    activeTab, setActiveTab, alerts, storageUsedBytes, storageQuotaBytes,
    children, expandedChildId, expandChild, addChild, editChild, removeChild,
    assignDeviceToChild, startAddDevice
  } = useRulesStore()

  const [dialog, setDialog] = React.useState(null)

  // Устройства, разложенные по профилям. Те, что ни к кому не привязаны,
  // показываются отдельной группой, а не прячутся: устройство без профиля
  // всё ещё работает и всё ещё требует внимания.
  const { byChild, orphans } = React.useMemo(() => {
    const map = new Map(children.map(c => [c.id, []]))
    const loose = []
    for (const device of sortDevices(devices)) {
      const bucket = device.childId ? map.get(device.childId) : null
      if (bucket) bucket.push(device)
      else loose.push(device)
    }
    return { byChild: map, orphans: loose }
  }, [devices, children])

  const handleSelect = (deviceId) => {
    selectDevice(deviceId)
    setShowSettings(false)
    if (activeTab === 'notifications') setActiveTab('permanent')
    onMobileNavigate?.()
  }

  // Порядок сохраняется общим списком, как и раньше; группы идут подряд,
  // поэтому склейка даёт тот же порядок, что видит родитель.
  const handleReorder = (childId, groupOrder) => {
    const all = []
    for (const child of children) {
      all.push(...(child.id === childId ? groupOrder : (byChild.get(child.id) ?? [])))
    }
    all.push(...(childId === null ? groupOrder : orphans))
    saveOrder(all.map(d => d.id))
  }

  const handleAddDevice = (childId = null) => {
    startAddDevice(childId)
    onMobileNavigate?.()
  }

  // Перенос и удаление идут на сервер, и отказ надо показать: значение в
  // списке просто вернётся на место, и без сообщения это выглядит как
  // «нажал, а ничего не произошло».
  const guard = (action) => async (...args) => {
    try {
      await action(...args)
    } catch (err) {
      window.alert(err?.message || 'Не удалось выполнить действие. Попробуйте ещё раз.')
    }
  }

  const moveDevice = guard(assignDeviceToChild)

  const confirmRemoveChild = async (child) => {
    const count = byChild.get(child.id)?.length ?? 0
    const warning = count > 0
      ? `\n\nУстройств в профиле: ${count}. Они останутся, но окажутся без профиля.`
      : ''
    if (!window.confirm(`Удалить профиль «${child.name}»?${warning}`)) return
    await guard(removeChild)(child.id)
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
        <div className="device-sidebar-group-label">
          {supportsChildren ? 'Дети' : 'Устройства'}
        </div>

        {supportsChildren && children.map(child => {
          const childDevices = byChild.get(child.id) ?? []
          const isExpanded = expandedChildId === child.id
          const hasSelected = childDevices.some(d => d.id === selectedDeviceId)

          return (
            <div key={child.id} className={`child-group ${isExpanded ? 'expanded' : ''}`}>
              <div className={`child-head ${hasSelected && !showSettings ? 'has-selected' : ''}`}>
                <button
                  className="child-head-main"
                  onClick={() => expandChild(child.id)}
                  aria-expanded={isExpanded}
                  title={child.note || child.name}
                >
                  <span className="child-avatar">{child.avatar}</span>
                  <span className="child-labels">
                    <span className="child-name">{child.name}</span>
                    <span className="child-sub">
                      {childDevices.length === 0
                        ? 'нет устройств'
                        : withCount(childDevices.length, 'устройство', 'устройства', 'устройств')}
                    </span>
                  </span>
                  <span className={`child-chevron ${isExpanded ? 'open' : ''}`}>›</span>
                </button>
                <button
                  className="child-edit-btn"
                  title="Изменить профиль"
                  onClick={() => setDialog({ child })}
                >
                  ✎
                </button>
                <button
                  className="child-edit-btn child-edit-btn--danger"
                  title="Удалить профиль"
                  onClick={() => confirmRemoveChild(child)}
                >
                  ×
                </button>
              </div>

              {isExpanded && (
                childDevices.length === 0 ? (
                  <button className="child-empty" onClick={() => handleAddDevice(child.id)}>
                    Добавить устройство
                  </button>
                ) : (
                  <DeviceGroup
                    devices={childDevices}
                    selectedDeviceId={selectedDeviceId}
                    showSettings={showSettings}
                    activeTab={activeTab}
                    onSelect={handleSelect}
                    onReorder={(order) => handleReorder(child.id, order)}
                    onMove={moveDevice}
                    childProfiles={children}
                  />
                )
              )}
            </div>
          )
        })}

        {orphans.length > 0 && (
          <div className="child-group expanded">
            {supportsChildren && (
              <div className="device-sidebar-group-label device-sidebar-group-label--sub">
                Без профиля
              </div>
            )}
            <DeviceGroup
              devices={orphans}
              selectedDeviceId={selectedDeviceId}
              showSettings={showSettings}
              activeTab={activeTab}
              onSelect={handleSelect}
              onReorder={(order) => handleReorder(null, order)}
              onMove={supportsChildren ? moveDevice : null}
              childProfiles={children}
            />
          </div>
        )}

        {devices.length === 0 && children.length === 0 && (
          <div className="device-sidebar-no-devices">
            <span className="device-sidebar-no-devices-icon">📡</span>
            <span>Нет устройств</span>
          </div>
        )}

        {supportsChildren && (
          <button className="device-sidebar-add-device" onClick={() => setDialog({ child: null })}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Добавить ребёнка
          </button>
        )}

        <button className="device-sidebar-add-device" onClick={() => handleAddDevice(expandedChildId)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Добавить устройство
        </button>
      </div>

      {dialog && (
        <ChildDialog
          child={dialog.child}
          onClose={() => setDialog(null)}
          onSave={(values) => dialog.child ? editChild(dialog.child.id, values) : addChild(values)}
        />
      )}

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
