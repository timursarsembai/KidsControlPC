import React, { useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './NotificationsPanel.css'

export default function NotificationsPanel() {
  const { alerts, acknowledgeAlert, acknowledgeAllAlerts, devices } = useRulesStore()
  const [activeTab, setActiveTab] = useState('unread')

  const unreadAlerts = alerts.filter(a => !a.acknowledged)
  const readAlerts   = alerts.filter(a => a.acknowledged)

  const displayedAlerts = activeTab === 'unread' ? unreadAlerts : readAlerts

  return (
    <div className="notifications-panel animate-in">
      <div className="notif-controls">
        <div className="notif-tabs">
          <button 
            className={`notif-tab ${activeTab === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveTab('unread')}
          >
            Непрочитанные <span className="badge">{unreadAlerts.length}</span>
          </button>
          <button 
            className={`notif-tab ${activeTab === 'read' ? 'active' : ''}`}
            onClick={() => setActiveTab('read')}
          >
            Прочитанные <span className="badge">{readAlerts.length}</span>
          </button>
        </div>
        
        {activeTab === 'unread' && unreadAlerts.length > 0 && (
          <button className="btn btn-sm btn-outline notif-mark-all" onClick={acknowledgeAllAlerts}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5L5 10.5L12 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Отметить все прочитанными
          </button>
        )}
      </div>

      <div className="notif-list">
        {displayedAlerts.length === 0 ? (
          <div className="empty-state" style={{ marginTop: '2rem' }}>
            <span className="empty-state-icon">📭</span>
            <span className="empty-state-title">Нет уведомлений</span>
            <span className="empty-state-desc">
              {activeTab === 'unread' ? 'У вас нет новых непрочитанных уведомлений.' : 'История уведомлений пуста.'}
            </span>
          </div>
        ) : (
          displayedAlerts.map(a => {
            const d = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp)
            const timeStr = d ? d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
            return (
              <div key={a.id} className={`notif-item ${a.acknowledged ? 'read' : 'unread'}`}>
                <div className="notif-icon">
                  {a.type === 'process_killed' ? '🛑' : a.type === 'agent_stopped' ? '⚠️' : '🔔'}
                </div>
                <div className="notif-content">
                  <div className="notif-title-row">
                    <span className="notif-title">
                      {a.type === 'process_killed' ? (a.details.startsWith('Blocked: ') ? a.details.replace('Blocked: ', '') : a.details) : 
                       a.type === 'agent_stopped' ? `Отключено: ${devices.find(d => d.id === a.deviceId)?.alias || a.deviceHostname || 'Устройство'}` : 
                       a.type === 'agent_started' ? `Подключено: ${devices.find(d => d.id === a.deviceId)?.alias || a.deviceHostname || 'Устройство'}` : a.type}
                    </span>
                    <span className="notif-time">{timeStr}</span>
                  </div>
                  <div className="notif-desc">
                    {a.type === 'process_killed' 
                       ? `Процесс заблокирован на ПК: ${devices.find(d => d.id === a.deviceId)?.alias || a.deviceHostname || 'Неизвестно'}` 
                       : a.details}
                  </div>
                </div>
                {!a.acknowledged && (
                  <button className="btn-ack-icon notif-ack-btn" title="Отметить как прочитанное" onClick={() => acknowledgeAlert(a.id)}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5L5 10.5L12 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

