import React, { useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { logger } from '@kidscontrol/shared/utils/logger'

export default function AppLogsSection() {
  const { devices } = useRulesStore()
  const [activeCategory, setActiveCategory] = useState('general')
  const [logs, setLogs] = useState(() => logger.getLogs(activeCategory))

  React.useEffect(() => {
    setLogs(logger.getLogs(activeCategory))
    const unsub = logger.subscribe((entry) => {
      if (entry.category === activeCategory) {
        setLogs(prev => [...prev, entry])
      }
    })
    return unsub
  }, [activeCategory])

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const LEVEL_ICONS = { info: '', warn: '⚠️', error: '❌' }
  const LEVEL_CLASSES = { info: '', warn: 'log-warn', error: 'log-error' }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">📋</div>
        <div>
          <h2 className="settings-section-title">Логи приложения</h2>
          <p className="settings-section-desc">Внутренние логи родительского интерфейса</p>
        </div>
      </div>

      <div className="app-logs-tabs">
        <button
          className={`app-logs-tab ${activeCategory === 'general' ? 'active' : ''}`}
          onClick={() => setActiveCategory('general')}
        >
          Общие
        </button>
        {devices.map(d => (
          <button
            key={d.id}
            className={`app-logs-tab ${activeCategory === d.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(d.id)}
          >
            {d.alias || d.hostname || d.id}
          </button>
        ))}
      </div>

      <div className="app-logs-container">
        {logs.length === 0 ? (
          <div className="app-logs-empty">Нет логов для этой категории</div>
        ) : (
          logs.map((entry, i) => (
            <div key={`${entry.ts}-${i}`} className={`log-line ${LEVEL_CLASSES[entry.level] || ''}`}>
              <span className="log-time">{formatTime(entry.ts)}</span>
              <span className="log-level-icon">{LEVEL_ICONS[entry.level] || ''}</span>
              <span className="log-msg">{entry.msg}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
