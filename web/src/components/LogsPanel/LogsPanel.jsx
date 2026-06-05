import React, { useRef, useEffect, useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './LogsPanel.css'

const LEVEL_ICONS = {
  info: '',
  warn: '⚠️',
  error: '❌'
}

const LEVEL_CLASSES = {
  info: '',
  warn: 'log-warn',
  error: 'log-error'
}

export default function LogsPanel() {
  const { devices, selectedDeviceId } = useRulesStore()
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const logsEndRef = useRef(null)
  const containerRef = useRef(null)

  const device = devices.find(d => d.id === selectedDeviceId)
  const logs = device?.recentLogs || []

  const filteredLogs = logs.filter(entry => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false
    if (filter && !entry.msg.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filteredLogs.length, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatDate = (ts) => {
    const d = new Date(ts)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }

  // Group logs by date
  let lastDate = null

  return (
    <div className="logs-panel">
      <div className="logs-toolbar">
        <div className="logs-search-wrap">
          <svg className="logs-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M9 9l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            className="logs-search-input"
            placeholder="Фильтр по тексту..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {filter && (
            <button className="logs-search-clear" onClick={() => setFilter('')}>×</button>
          )}
        </div>
        <div className="logs-level-filter">
          {['all', 'info', 'warn', 'error'].map(level => (
            <button
              key={level}
              className={`logs-level-btn ${levelFilter === level ? 'active' : ''}`}
              onClick={() => setLevelFilter(level)}
            >
              {level === 'all' ? 'Все' : level === 'info' ? 'Инфо' : level === 'warn' ? 'Warn' : 'Error'}
            </button>
          ))}
        </div>
        <div className="logs-count">
          {filteredLogs.length} / {logs.length}
        </div>
      </div>

      <div className="logs-container" ref={containerRef} onScroll={handleScroll}>
        {logs.length === 0 ? (
          <div className="logs-empty">
            <span className="logs-empty-icon">📋</span>
            <p>Нет логов агента</p>
            <p className="logs-empty-sub">Логи появятся после запуска агента на детском ПК</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="logs-empty">
            <span className="logs-empty-icon">🔍</span>
            <p>Ничего не найдено</p>
            <p className="logs-empty-sub">Попробуйте изменить фильтр</p>
          </div>
        ) : (
          <>
            {filteredLogs.map((entry, i) => {
              const date = formatDate(entry.ts)
              const showDateSep = date !== lastDate
              lastDate = date

              return (
                <React.Fragment key={`${entry.ts}-${i}`}>
                  {showDateSep && (
                    <div className="logs-date-separator">
                      <span>{date}</span>
                    </div>
                  )}
                  <div className={`log-line ${LEVEL_CLASSES[entry.level] || ''}`}>
                    <span className="log-time">{formatTime(entry.ts)}</span>
                    <span className="log-level-icon">{LEVEL_ICONS[entry.level] || ''}</span>
                    <span className="log-msg">{entry.msg}</span>
                  </div>
                </React.Fragment>
              )
            })}
            <div ref={logsEndRef} />
          </>
        )}
      </div>

      {!autoScroll && filteredLogs.length > 0 && (
        <button
          className="logs-scroll-bottom"
          onClick={() => {
            setAutoScroll(true)
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
          }}
        >
          ↓ К последним
        </button>
      )}
    </div>
  )
}
