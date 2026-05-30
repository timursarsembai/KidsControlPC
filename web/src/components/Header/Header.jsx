import React, { useState, useRef, useEffect } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './Header.css'

export default function Header({ onSignOut }) {
  const { user, alerts, acknowledgeAlert, acknowledgeAllAlerts, setActiveTab, selectedDeviceId, devices } = useRulesStore()
  const unreadAlertsList = alerts.filter(a => !a.acknowledged)
  const unreadAlerts = unreadAlertsList.length

  const activeDevice = devices.find(d => d.id === selectedDeviceId)
  const lastSeen = activeDevice?.lastSeen?.toDate?.() || (activeDevice?.lastSeen ? new Date(activeDevice.lastSeen.seconds ? activeDevice.lastSeen.seconds * 1000 : activeDevice.lastSeen) : null)
  const isOnline = activeDevice ? (activeDevice.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000) : false

  const [showAlerts, setShowAlerts] = useState(false)
  const bellRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setShowAlerts(false)
      }
    }
    if (showAlerts) document.addEventListener('mousedown', handleClickOutside, { capture: true })
    return () => document.removeEventListener('mousedown', handleClickOutside, { capture: true })
  }, [showAlerts])

  useEffect(() => {
    if (unreadAlerts === 0) {
      setShowAlerts(false)
    }
  }, [unreadAlerts])

  return (
    <div className="header">
      <div className="header-left">
        <div className="header-logo">
          <span className="header-logo-icon">🛡️</span>
          <span className="header-logo-name">KidsControl</span>
          <span className="header-logo-sub">PC</span>
        </div>
      </div>

      <div className="header-center">
        {/* Sync indicator */}
        {activeDevice && (
          <div className="sync-indicator">
            <span className={`status-dot ${isOnline ? 'active' : 'inactive'}`} />
            <span className="sync-text">{isOnline ? 'Синхронизировано' : 'Агент отключен'}</span>
          </div>
        )}
      </div>

      <div className="header-right">
        {/* Alerts bell */}
        <div className="alert-bell-wrapper" ref={bellRef}>
          {unreadAlerts > 0 && (
            <div className={`alert-bell ${showAlerts ? 'active' : ''}`} 
                 onClick={() => setShowAlerts(!showAlerts)}
                 title={`${unreadAlerts} новых тревог`}>
              <span>🔔</span>
              <span className="alert-count">{unreadAlerts}</span>
            </div>
          )}
          {showAlerts && (
            <div className="alerts-dropdown">
              <div className="alerts-header">
                <span>Уведомления</span>
                {unreadAlerts > 0 && (
                  <button className="btn-mark-all" onClick={acknowledgeAllAlerts}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5L5 10.5L12 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Отметить все
                  </button>
                )}
              </div>
              <div className="alerts-body">
                {unreadAlertsList.length === 0 ? (
                  <div className="alert-empty">Нет новых уведомлений</div>
                ) : unreadAlertsList.slice(0, 5).map(a => {
                  const d = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp)
                  const timeStr = d ? d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
                  return (
                    <div key={a.id} className={`alert-item ${a.acknowledged ? 'ack' : 'unread'}`}>
                      <div className="alert-icon">
                        {a.type === 'process_killed' ? '🛑' : a.type === 'agent_stopped' ? '⚠️' : '🔔'}
                      </div>
                      <div className="alert-content">
                        <div className="alert-title-row">
                          <span className="alert-title">
                            {a.type === 'process_killed' ? 'Процесс заблокирован' : 
                             a.type === 'agent_stopped' ? `Отключено: ${devices.find(d => d.id === a.deviceId)?.alias || a.deviceHostname || 'Устройство'}` : 
                             a.type === 'agent_started' ? `Подключено: ${devices.find(d => d.id === a.deviceId)?.alias || a.deviceHostname || 'Устройство'}` : a.type}
                          </span>
                          <span className="alert-time">{timeStr}</span>
                        </div>
                        <div className="alert-desc">
                          {(a.type === 'agent_stopped' || a.type === 'agent_started') 
                             ? a.details 
                             : a.details}
                        </div>
                      </div>
                      {!a.acknowledged && (
                        <button className="btn-ack-icon" title="Отметить как прочитанное" onClick={() => acknowledgeAlert(a.id)}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5L5 10.5L12 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="alerts-footer">
                <button className="btn-view-all" onClick={() => { setShowAlerts(false); setActiveTab('notifications'); }}>
                  Все уведомления
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User email */}
        {user && (
          <div className="header-user">
            <span className="user-email">{user.email}</span>
            <button className="btn-signout" onClick={onSignOut} title="Выйти">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M5 1H2a1 1 0 00-1 1v9a1 1 0 001 1h3M9 9l3-2.5L9 4M4 6.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
