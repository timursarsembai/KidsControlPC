import React, { useState, useEffect, useMemo } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import Select from '../Select/Select'
import './PomodoroPanel.css'

function timestampToDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  if (typeof value === 'number') return new Date(value)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function timestampToMs(value) {
  const date = timestampToDate(value)
  return date ? date.getTime() : null
}

function formatPomodoroTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function getPomodoroElapsedMs(session, nowMs) {
  if (!session) return 0
  if (session.status === 'paused') {
    return Math.max(0, Number(session.pausedElapsedMs ?? session.elapsedBeforePauseMs ?? 0))
  }

  const startedAtMs = timestampToMs(session.startedAtClientMs) ?? timestampToMs(session.startedAt)
  if (!startedAtMs) return Math.max(0, Number(session.elapsedBeforePauseMs || 0))
  return Math.max(0, Number(session.elapsedBeforePauseMs || 0) + nowMs - startedAtMs)
}

function getPomodoroPhase(session, nowMs) {
  if (!session) return { phase: 'idle', timeLeft: '', elapsedMs: 0 }

  const elapsedMs = getPomodoroElapsedMs(session, nowMs)
  const workMs = Number(session.workDuration || 25) * 60 * 1000
  const breakMs = Number(session.breakDuration || 5) * 60 * 1000
  const longBreakMs = Number(session.longBreakDuration || 15) * 60 * 1000
  const cyclesToLongBreak = Number(session.cyclesToLongBreak || 3)
  const blockMs = (workMs + breakMs) * (cyclesToLongBreak - 1) + (workMs + longBreakMs)
  const blockElapsed = blockMs > 0 ? elapsedMs % blockMs : 0

  let currentElapsed = 0
  for (let i = 0; i < cyclesToLongBreak; i++) {
    if (blockElapsed < currentElapsed + workMs) {
      return { phase: 'work', timeLeft: formatPomodoroTime(currentElapsed + workMs - blockElapsed), elapsedMs }
    }
    currentElapsed += workMs

    const currentBreakMs = i === cyclesToLongBreak - 1 ? longBreakMs : breakMs
    if (blockElapsed < currentElapsed + currentBreakMs) {
      return {
        phase: i === cyclesToLongBreak - 1 ? 'long-break' : 'break',
        timeLeft: formatPomodoroTime(currentElapsed + currentBreakMs - blockElapsed),
        elapsedMs
      }
    }
    currentElapsed += currentBreakMs
  }

  return { phase: 'idle', timeLeft: '', elapsedMs }
}

export default function PomodoroPanel() {
  const { 
    installedApps, rules, getFilteredWebsites, togglePomodoroSession, pausePomodoroSession, stopPomodoroSession, getPomodoroSession,
    activeSubTab, addWebsite,
    selectedDeviceId, devices
  } = useRulesStore()
  
  const selectedDevice = devices.find(d => d.id === selectedDeviceId)
  const lastSeen = selectedDevice?.lastSeen?.toDate?.()
  const isOnline = selectedDevice?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000
  
  const allWebsites = useMemo(() => getFilteredWebsites(), [rules, getFilteredWebsites])
  const currentSession = getPomodoroSession()
  const agentPomodoroState = selectedDevice?.pomodoroState
  const isAgentPomodoroActive = Boolean(isOnline && agentPomodoroState?.active && agentPomodoroState?.phaseEndsAtMs)
  const isRuleActive = currentSession?.status === 'active'
  const isPaused = currentSession?.status === 'paused'
  const isActive = isRuleActive || isAgentPomodoroActive
  const hasSession = isActive || isPaused

  const [workMins, setWorkMins] = useState(currentSession?.workDuration || 25)
  const [breakMins, setBreakMins] = useState(currentSession?.breakDuration || 5)
  const [longBreakMins, setLongBreakMins] = useState(currentSession?.longBreakDuration || 15)
  const [cycles, setCycles] = useState(currentSession?.cyclesToLongBreak || 3)
  
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

  const [searchStr, setSearchStr] = useState('')
  const [filterStr, setFilterStr] = useState('all')

  const filteredPrograms = useMemo(() => {
    return installedApps.filter(app => {
      if (searchStr && !app.name.toLowerCase().includes(searchStr.toLowerCase())) return false;
      if (filterStr === 'selected' && !selectedPrograms.has(app.name)) return false;
      return true;
    })
  }, [installedApps, searchStr, filterStr, selectedPrograms])

  const filteredWebsites = useMemo(() => {
    return allWebsites.filter(site => {
      const url = site.resolvedPattern || site.inputUrl;
      if (searchStr && !url.toLowerCase().includes(searchStr.toLowerCase())) return false;
      if (filterStr === 'selected' && !selectedWebsites.has(url)) return false;
      return true;
    })
  }, [allWebsites, searchStr, filterStr, selectedWebsites])

  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Calculate current phase
  let phase = 'idle'
  let timeLeft = ''
  let elapsedMs = 0
  if (isAgentPomodoroActive) {
    phase = agentPomodoroState.phase || (agentPomodoroState.isWorkPhase ? 'work' : 'break')
    timeLeft = formatPomodoroTime(agentPomodoroState.phaseEndsAtMs - now.getTime())
    elapsedMs = getPomodoroElapsedMs(currentSession, now.getTime())
  } else if (isRuleActive || isPaused) {
    const phaseState = getPomodoroPhase(currentSession, now.getTime())
    phase = phaseState.phase
    timeLeft = phaseState.timeLeft
    elapsedMs = phaseState.elapsedMs
  }

  const handleStartOrResume = () => {
    if (isPaused) {
      togglePomodoroSession(true, { elapsedBeforePauseMs: elapsedMs })
      return
    }

    const store = useRulesStore.getState()
    const conflictPrograms = Array.from(selectedPrograms).filter(p => store.checkRuleConflict('program', p, 'pomodoro'))
    const conflictWebsites = Array.from(selectedWebsites).filter(w => store.checkRuleConflict('web', w, 'pomodoro'))
      
      if (conflictPrograms.length > 0 || conflictWebsites.length > 0) {
        alert('Конфликт правил!\n\nСледующие ресурсы уже блокируются в других режимах:\n' + 
              [...conflictPrograms, ...conflictWebsites].join(', ') +
              '\n\nСначала отключите их, чтобы запустить сессию Помодоро.')
        return
      }

    togglePomodoroSession(true, {
      workDuration: Number(workMins),
      breakDuration: Number(breakMins),
      longBreakDuration: Number(longBreakMins),
      cyclesToLongBreak: Number(cycles),
      targets: {
        programs: Array.from(selectedPrograms),
        websites: Array.from(selectedWebsites)
      }
    })
  }

  const handlePause = () => {
    pausePomodoroSession(elapsedMs)
  }

  const handleStop = () => {
    stopPomodoroSession()
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
        longBreakDuration: Number(longBreakMins),
        cyclesToLongBreak: Number(cycles),
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
            <input type="number" className="input" value={workMins} onChange={e => setWorkMins(e.target.value)} disabled={hasSession} min="1" max="1440" />
          </div>
          <div className="input-group">
            <label>Пауза (мин)</label>
            <input type="number" className="input" value={breakMins} onChange={e => setBreakMins(e.target.value)} disabled={hasSession} min="1" max="1440" />
          </div>
          <div className="input-group">
            <label>Длин. пауза (мин)</label>
            <input type="number" className="input" value={longBreakMins} onChange={e => setLongBreakMins(e.target.value)} disabled={hasSession} min="1" max="1440" />
          </div>
          <div className="input-group">
            <label>Циклов до длин. паузы</label>
            <input type="number" className="input" value={cycles} onChange={e => setCycles(e.target.value)} disabled={hasSession} min="1" max="100" />
          </div>
          <button className={`btn ${isActive ? 'btn-danger' : 'btn-primary'}`} onClick={handleStartOrResume} style={{ display: hasSession ? 'none' : undefined }}>
            {isActive ? 'Остановить сессию' : 'Запустить сессию'}
          </button>
          {isActive && <button className="btn btn-ghost" onClick={handlePause}>Пауза</button>}
          {isPaused && <button className="btn btn-primary" onClick={handleStartOrResume}>Продолжить</button>}
          {hasSession && <button className="btn btn-danger" onClick={handleStop}>Остановить</button>}
        </div>

        <div className={`pomodoro-status ${phase}`}>
          {phase === 'idle' && (
            <>
              <div className="status-label" style={{ color: 'var(--text-secondary)' }}>Ожидание запуска</div>
              <div className="status-time" style={{ color: 'var(--text-tertiary)' }}>00:00:00</div>
            </>
          )}
          {isPaused && (
            <>
              <div className="status-label">Сессия на паузе</div>
              <div className="status-time">{timeLeft || '00:00'}</div>
            </>
          )}
          {!isPaused && phase === 'work' && (
            <>
              <div className="status-label">Блокировка активна</div>
              <div className="status-time">{timeLeft}</div>
            </>
          )}
          {!isPaused && phase === 'break' && (
            <>
              <div className="status-label">Пауза (доступ открыт)</div>
              <div className="status-time">{timeLeft}</div>
            </>
          )}
          {!isPaused && phase === 'long-break' && (
            <>
              <div className="status-label">Длинная пауза (доступ открыт)</div>
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
              <Select 
                value={scope}
                onChange={val => setScope(val)}
                options={[
                  { value: 'exact', label: 'Только этот адрес' },
                  { value: 'path', label: 'Все внутренние страницы' },
                  { value: 'domain', label: 'Весь домен и ресурсы' }
                ]}
                style={{ width: 220 }}
              />
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

      {/* Controls */}
      <div className="panel-controls">
        <div className="search-wrap">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input type="text" className="input search-input"
            placeholder={activeSubTab === 'programs' ? "Поиск программы..." : "Поиск веб-ресурса..."}
            value={searchStr}
            onChange={e => setSearchStr(e.target.value)} />
        </div>
        
        <Select 
          value={filterStr}
          onChange={val => setFilterStr(val)}
          style={{ width: 220 }}
          options={[
            { value: 'all', label: activeSubTab === 'programs' ? 'Все программы' : 'Все ресурсы' },
            { value: 'selected', label: 'Выбраны для сессии' }
          ]}
        />
        
        <div className="sync-status">
          <span className={`sync-dot ${isOnline ? 'active' : 'inactive'}`} />
          {isOnline ? 'Синхронизация с агентом' : 'Агент отключен'}
        </div>
      </div>

      {/* Table */}
      <div className="table-container" style={{ flex: 1, minHeight: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{activeSubTab === 'programs' ? 'Программа' : 'Веб-ресурс'}</th>
              <th style={{ width: 160 }}>Включить в сессию</th>
            </tr>
          </thead>
          <tbody>
            {activeSubTab === 'programs' && filteredPrograms.map(app => (
              <tr key={app.id}>
                <td>
                  <div className="prog-name">{app.name}</div>
                  {app.path ? <div className="prog-path">{app.path}</div> : <div className="prog-path no-path">Путь неизвестен</div>}
                </td>
                <td>
                  <label className={`custom-checkbox ${hasSession ? 'disabled' : ''}`}>
                    <input 
                      type="checkbox" 
                      disabled={hasSession}
                      checked={selectedPrograms.has(app.name)}
                      onChange={() => toggleProgram(app.name)}
                    />
                    <span className="checkmark"></span>
                  </label>
                </td>
              </tr>
            ))}

            {activeSubTab === 'web' && filteredWebsites.length === 0 && (
              <tr>
                <td colSpan={2}>
                  <div className="empty-state">
                    <span className="empty-state-icon">🌐</span>
                    <span className="empty-state-title">Нет добавленных ресурсов</span>
                    <span className="empty-state-desc">Введите URL выше и нажмите «Добавить»</span>
                  </div>
                </td>
              </tr>
            )}

            {activeSubTab === 'web' && filteredWebsites.map(site => {
              const url = site.resolvedPattern || site.inputUrl
              return (
                <tr key={site.id}>
                  <td>
                    <div className="prog-name">{url}</div>
                  </td>
                  <td>
                    <label className={`custom-checkbox ${hasSession ? 'disabled' : ''}`}>
                      <input 
                        type="checkbox" 
                        disabled={hasSession}
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

