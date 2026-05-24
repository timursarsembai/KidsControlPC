import React, { useState, useEffect, useMemo } from 'react'
import { useRulesStore } from '../../stores/useRulesStore'
import './PomodoroPanel.css'

export default function PomodoroPanel() {
  const { 
    installedApps, rules, getFilteredWebsites, togglePomodoroSession, getPomodoroSession,
    activeSubTab, addWebsite
  } = useRulesStore()
  
  const allWebsites = useMemo(() => getFilteredWebsites(), [rules, getFilteredWebsites])
  const currentSession = getPomodoroSession()
  const isActive = currentSession?.status === 'active'

  const [workMins, setWorkMins] = useState(currentSession?.workDuration || 25)
  const [breakMins, setBreakMins] = useState(currentSession?.breakDuration || 5)
  
  // Targets state
  const [selectedPrograms, setSelectedPrograms] = useState(() => 
    new Set(currentSession?.targets?.programs || [])
  )
  const [selectedWebsites, setSelectedWebsites] = useState(() => 
    new Set(currentSession?.targets?.websites || [])
  )

  const [urlInput, setUrlInput] = useState('')
  const [scope, setScope]       = useState('domain')
  const [error, setError]       = useState('')

  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Calculate current phase
  let phase = 'idle'
  let timeLeft = ''
  if (isActive && currentSession?.startedAt) {
    const startedAt = currentSession.startedAt?.toDate?.() || new Date(currentSession.startedAt)
    const elapsed = now - startedAt
    const cycleMs = (currentSession.workDuration + currentSession.breakDuration) * 60 * 1000
    const remainder = elapsed % cycleMs
    const workMs = currentSession.workDuration * 60 * 1000
    
    if (remainder < workMs) {
      phase = 'work'
      const leftMs = workMs - remainder
      const m = Math.floor(leftMs / 60000)
      const s = Math.floor((leftMs % 60000) / 1000)
      timeLeft = `${m}:${s.toString().padStart(2, '0')}`
    } else {
      phase = 'break'
      const leftMs = cycleMs - remainder
      const m = Math.floor(leftMs / 60000)
      const s = Math.floor((leftMs % 60000) / 1000)
      timeLeft = `${m}:${s.toString().padStart(2, '0')}`
    }
  }

  const handleToggle = () => {
    if (isActive) {
      togglePomodoroSession(false)
    } else {
      togglePomodoroSession(true, {
        workDuration: Number(workMins),
        breakDuration: Number(breakMins),
        targets: {
          programs: Array.from(selectedPrograms),
          websites: Array.from(selectedWebsites)
        }
      })
    }
  }

  const toggleProgram = (name) => {
    const next = new Set(selectedPrograms)
    next.has(name) ? next.delete(name) : next.add(name)
    setSelectedPrograms(next)
  }

  const toggleWebsite = (url) => {
    const next = new Set(selectedWebsites)
    next.has(url) ? next.delete(url) : next.add(url)
    setSelectedWebsites(next)
  }

  const resolvePattern = (url, scope) => {
    try {
      const cleaned = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (scope === 'domain') return cleaned.split('/')[0]
      if (scope === 'path')   return cleaned.split('/').slice(0,2).join('/')
      return cleaned
    } catch { return url }
  }

  const handleAddWebsite = () => {
    if (!urlInput.trim()) { setError('Введите URL'); return }
    setError('')
    const resolved = resolvePattern(urlInput.trim(), scope)
    addWebsite({
      inputUrl: urlInput.trim(),
      scope,
      resolvedPattern: resolved
    })
    
    const next = new Set(selectedWebsites)
    next.add(resolved)
    setSelectedWebsites(next)
    
    if (isActive) {
      togglePomodoroSession(true, {
        workDuration: Number(workMins),
        breakDuration: Number(breakMins),
        targets: {
          programs: Array.from(selectedPrograms),
          websites: Array.from(next)
        }
      })
    }
    
    setUrlInput('')
  }

  return (
    <div className="pomodoro-panel animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'hidden' }}>
      
      {/* Top Config */}
      <div className="pomodoro-top-card">
        <div className="pomodoro-settings">
          <div className="input-group">
            <label>Работа (мин)</label>
            <input type="number" className="input" value={workMins} onChange={e => setWorkMins(e.target.value)} disabled={isActive} min="1" max="1440" />
          </div>
          <div className="input-group">
            <label>Пауза (мин)</label>
            <input type="number" className="input" value={breakMins} onChange={e => setBreakMins(e.target.value)} disabled={isActive} min="1" max="1440" />
          </div>
          <button className={`btn ${isActive ? 'btn-danger' : 'btn-primary'}`} style={{ marginTop: 22 }} onClick={handleToggle}>
            {isActive ? 'Остановить сессию' : 'Запустить сессию'}
          </button>
        </div>

        <div className={`pomodoro-status ${phase}`}>
          {phase === 'idle' && (
            <>
              <div className="status-label" style={{ color: 'var(--text-secondary)' }}>Ожидание запуска</div>
              <div className="status-time" style={{ color: 'var(--text-tertiary)' }}>00:00:00</div>
            </>
          )}
          {phase === 'work' && (
            <>
              <div className="status-label">Блокировка активна</div>
              <div className="status-time">{timeLeft}</div>
            </>
          )}
          {phase === 'break' && (
            <>
              <div className="status-label">Пауза (доступ открыт)</div>
              <div className="status-time">{timeLeft}</div>
            </>
          )}
        </div>
      </div>

      {/* Web Resource Input Form (Only for Web Tab) */}
      {activeSubTab === 'web' && (
        <div className="web-add-card" style={{ flexShrink: 0 }}>
          <div className="web-add-header">
            <span className="web-add-title">Добавить веб-ресурс</span>
            <span className="web-add-hint">После добавления он появится в списке ниже</span>
          </div>
          <div className="web-add-form">
            <div className="url-input-wrap">
              <span className="url-prefix">🌐</span>
              <input
                type="text"
                className={`input url-input ${error ? 'input-error' : ''}`}
                placeholder="youtube.com/shorts или vk.com/feed"
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleAddWebsite()}
              />
            </div>
            <div className="scope-select-wrap">
              <select className="input select scope-select" value={scope} onChange={e => setScope(e.target.value)}>
                <option value="exact">Только этот адрес</option>
                <option value="path">Все внутренние страницы</option>
                <option value="domain">Весь домен и все его ресурсы</option>
              </select>
            </div>
            <button className="btn btn-primary add-btn" onClick={handleAddWebsite}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Добавить
            </button>
          </div>
          {error && <div className="input-error-msg">{error}</div>}
        </div>
      )}

      {/* Table */}
      <div className="table-container" style={{ flex: 1, minHeight: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>●</th>
              <th>{activeSubTab === 'programs' ? 'Программа' : 'Веб-ресурс'}</th>
              <th style={{ width: 160 }}>Включить в сессию</th>
            </tr>
          </thead>
          <tbody>
            {activeSubTab === 'programs' && installedApps.map(app => (
              <tr key={app.id}>
                <td>
                  <span className={`status-dot ${app.running ? 'active' : 'inactive'}`} title={app.running ? 'Запущена сейчас' : 'Не запущена'} />
                </td>
                <td>
                  <div className="prog-name">{app.name}</div>
                  {app.path ? <div className="prog-path">{app.path}</div> : <div className="prog-path no-path">Путь неизвестен</div>}
                </td>
                <td>
                  <label className={`custom-checkbox ${isActive ? 'disabled' : ''}`}>
                    <input 
                      type="checkbox" 
                      disabled={isActive}
                      checked={selectedPrograms.has(app.name)}
                      onChange={() => toggleProgram(app.name)}
                    />
                    <span className="checkmark"></span>
                  </label>
                </td>
              </tr>
            ))}

            {activeSubTab === 'web' && allWebsites.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <div className="empty-state">
                    <span className="empty-state-icon">🌐</span>
                    <span className="empty-state-title">Нет добавленных ресурсов</span>
                    <span className="empty-state-desc">Введите URL выше и нажмите «Добавить»</span>
                  </div>
                </td>
              </tr>
            )}

            {activeSubTab === 'web' && allWebsites.map(site => {
              const url = site.resolvedPattern || site.inputUrl
              return (
                <tr key={site.id}>
                  <td>
                    <span className="status-dot inactive" />
                  </td>
                  <td>
                    <div className="prog-name">{url}</div>
                  </td>
                  <td>
                    <label className={`custom-checkbox ${isActive ? 'disabled' : ''}`}>
                      <input 
                        type="checkbox" 
                        disabled={isActive}
                        checked={selectedWebsites.has(url)}
                        onChange={() => toggleWebsite(url)}
                      />
                      <span className="checkmark"></span>
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
