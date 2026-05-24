import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useRulesStore } from '../../stores/useRulesStore'
import { evaluateRule } from '../../utils/timeHelpers'
import Select from '../Select/Select'
import './ProgramsPanel.css'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// ─── Sub-inputs for timer/schedule/date modes ────────────────────────────────
function TimerInput({ value, onChange }) {
  return (
    <div className="timer-input-wrap" onClick={e => e.stopPropagation()}>
      <input type="number" className="input timer-input"
        placeholder="мин" min="1" max="1440"
        value={value || ''}
        onChange={e => onChange(e.target.value)} />
      <span className="timer-unit">мин</span>
    </div>
  )
}

function ScheduleInput({ value, onChange }) {
  const days = value?.weekdays || []
  const toggleDay = (i) => {
    const next = days.includes(i) ? days.filter(d => d !== i) : [...days, i]
    onChange({ ...value, weekdays: next })
  }
  return (
    <div className="schedule-input-wrap" onClick={e => e.stopPropagation()}>
      <div className="checkbox-group">
        {DAYS.map((d, i) => (
          <label key={i} className={`day-label ${days.includes(i) ? 'checked' : ''}`}
            onClick={() => toggleDay(i)}>{d}</label>
        ))}
      </div>
      <div className="time-range">
        <input type="time" className="input time-input" value={value?.timeFrom || ''}
          onChange={e => onChange({ ...value, timeFrom: e.target.value })} />
        <span className="time-sep">—</span>
        <input type="time" className="input time-input" value={value?.timeTo || ''}
          onChange={e => onChange({ ...value, timeTo: e.target.value })} />
      </div>
    </div>
  )
}

function DateInput({ value, onChange }) {
  return (
    <div className="schedule-input-wrap" onClick={e => e.stopPropagation()}>
      <input type="date" className="input date-input" value={value?.date || ''}
        onChange={e => onChange({ ...value, date: e.target.value })} />
      <div className="time-range">
        <input type="time" className="input time-input" value={value?.timeFrom || ''}
          onChange={e => onChange({ ...value, timeFrom: e.target.value })} />
        <span className="time-sep">—</span>
        <input type="time" className="input time-input" value={value?.timeTo || ''}
          onChange={e => onChange({ ...value, timeTo: e.target.value })} />
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ProgramsPanel({ mode }) {
  const {
    programSearch, setProgramSearch,
    programFilter, setProgramFilter,
    getFilteredPrograms,
    appsLoading,
    toggleProgramBlock, addProgramRule,
    selectedDeviceId, devices
  } = useRulesStore()

  const selectedDevice = devices.find(d => d.id === selectedDeviceId)
  const lastSeen = selectedDevice?.lastSeen?.toDate?.()
  const isOnline = selectedDevice?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000

  // Subscribe to store updates
  const installedApps = useRulesStore(state => state.installedApps)
  const rules = useRulesStore(state => state.rules)

  const [ruleData, setRuleData]         = useState({})
  const [pendingBlocks, setPendingBlocks] = useState(new Set()) // IDs being saved
  const [now, setNow] = useState(new Date())

  // Update clock every second for real-time countdowns
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const updateRuleData = useCallback((id, val) => {
    setRuleData(prev => ({ ...prev, [id]: val }))
  }, [])

  // Derived merged and filtered apps from store
  const mergedApps = useMemo(() => {
    const apps = getFilteredPrograms()
    const data = {}
    apps.forEach(app => {
      const rule = rules.find(r => r.type === 'program' && r.mode === mode && r.program.name === app.name)
      const evaluation = evaluateRule(rule, now)
      data[app.id] = {
        ruleId: rule?.id,
        isBlockedByTime: evaluation.isBlocked,
        statusText: evaluation.statusText,
        timer: rule?.timer || {},
        schedule: rule?.schedule || {},
        date: rule?.date || {}
      }
    })
    setRuleData(data)
    return apps
  }, [installedApps, rules, programSearch, programFilter, getFilteredPrograms, mode, now])

  // Auto-disable expired timers
  useEffect(() => {
    if (mode !== 'timer') return
    mergedApps.forEach(app => {
      const evaluation = ruleData[app.id]
      if (app.blocked && evaluation?.statusText === 'Время вышло' && !pendingBlocks.has(app.id)) {
        if (app.ruleId) {
          toggleProgramBlock(app.ruleId, true)
        }
      }
    })
  }, [mergedApps, ruleData, mode, pendingBlocks, toggleProgramBlock])

  // ── Block a program ──
  const handleBlock = useCallback(async (app) => {
    setPendingBlocks(prev => new Set([...prev, app.id]))
    try {
      if (app.ruleId) {
        await toggleProgramBlock(app.ruleId, app.blocked, ruleData[app.id])
      } else {
        await addProgramRule(
          { name: app.name, path: app.path },
          mode,
          ruleData[app.id]
        )
      }
    } finally {
      setPendingBlocks(prev => { const s = new Set(prev); s.delete(app.id); return s })
    }
  }, [mode, ruleData, toggleProgramBlock, addProgramRule])

  // ── Unblock / remove rule ──
  const handleUnblock = useCallback(async (app) => {
    if (!app.ruleId) return
    setPendingBlocks(prev => new Set([...prev, app.id]))
    try {
      await toggleProgramBlock(app.ruleId, true)
    } finally {
      setPendingBlocks(prev => { const s = new Set(prev); s.delete(app.id); return s })
    }
  }, [toggleProgramBlock])

  const colSpan = mode === 'permanent' ? 3 : 4

  return (
    <div className="programs-panel animate-in">
      {/* Controls */}
      <div className="panel-controls">
        <div className="search-wrap">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input type="text" className="input search-input"
            placeholder="Поиск программы..."
            value={programSearch}
            onChange={e => setProgramSearch(e.target.value)} />
        </div>
        
        <Select 
          value={programFilter}
          onChange={val => setProgramFilter(val)}
          style={{ width: 220 }}
          options={[
            { value: 'all', label: 'Все программы' },
            { value: 'blocked', label: 'Заблокированы' },
            { value: 'unblocked', label: 'Незаблокированы' }
          ]}
        />
        
        <div className="sync-status">
          <span className={`sync-dot ${isOnline ? 'active' : 'inactive'}`} />
          {isOnline ? 'Синхронизация с агентом' : 'Агент отключен'}
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Программа</th>
              {mode === 'timer'    && <th>Таймер</th>}
              {mode === 'schedule' && <th>Расписание</th>}
              {mode === 'date'     && <th>Дата и время</th>}
              <th style={{ width: 150 }}>Статус</th>
              <th style={{ width: 160 }}>Действие</th>
            </tr>
          </thead>
          <tbody>
            {appsLoading ? (
              <tr><td colSpan={colSpan}>
                <div className="empty-state">
                  <div className="loading-spinner" />
                  <span className="empty-state-title">Загрузка программ с устройства...</span>
                  <span className="empty-state-desc">Синхронизируем базу данных приложений</span>
                </div>
              </td></tr>
            ) : mergedApps.length === 0 ? (
              <tr><td colSpan={colSpan}>
                <div className="empty-state">
                  <span className="empty-state-icon">🔍</span>
                  <span className="empty-state-title">Ничего не найдено</span>
                  <span className="empty-state-desc">Убедитесь, что агент запущен на детском ПК и загрузил список программ</span>
                </div>
              </td></tr>
            ) : mergedApps.map(app => {
              const isPending = pendingBlocks.has(app.id)
              return (
                <tr key={app.id}>
                  {/* Name & path */}
                  <td>
                    <div className="prog-name">{app.name}</div>
                    {app.path
                      ? <div className="prog-path">{app.path}</div>
                      : <div className="prog-path no-path">Путь неизвестен</div>
                    }
                    {app.publisher && <div className="prog-publisher">{app.publisher}</div>}
                  </td>

                  {/* Dynamic column */}
                  {mode === 'timer' && (
                    <td>
                      <TimerInput value={ruleData[app.id]?.timer?.duration}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], timer: { duration: v } })} />
                    </td>
                  )}
                  {mode === 'schedule' && (
                    <td>
                      <ScheduleInput value={ruleData[app.id]?.schedule}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], schedule: v })} />
                    </td>
                  )}
                  {mode === 'date' && (
                    <td>
                      <DateInput value={ruleData[app.id]?.date}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], date: v })} />
                    </td>
                  )}

                  {/* Status badge */}
                  <td>
                    <div className="status-cell">
                      <span className={`status-dot ${app.blocked ? 'blocked' : 'unblocked'}`} />
                      <span className="status-text">
                        {app.blocked 
                          ? (ruleData[app.id]?.isBlockedByTime ? 'Заблокирован' : 'Ожидание') 
                          : 'Отключен'}
                      </span>
                    </div>
                    {ruleData[app.id]?.statusText && mode !== 'permanent' && (
                      <div className="countdown-text" style={{ fontSize: '0.75rem', color: '#8b8d98', marginTop: 2 }}>
                        {ruleData[app.id].statusText}
                      </div>
                    )}
                  </td>

                  {/* Action */}
                  <td>
                    <button
                      className={`btn btn-sm ${app.blocked ? 'btn-success' : 'btn-danger'}`}
                      disabled={isPending}
                      onClick={() => app.blocked ? handleUnblock(app) : handleBlock(app)}
                    >
                      {isPending
                        ? <span className="btn-spinner-sm" />
                        : app.blocked ? 'Отключить правило' : 'Включить правило'
                      }
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="panel-footer">
        <span className="footer-count">
          {appsLoading
            ? 'Загрузка...'
            : `${mergedApps.filter(a => a.blocked).length} из ${mergedApps.length} заблокировано`
          }
        </span>
        {!appsLoading && (
          <span className="footer-hint">
            {installedApps.length} программ синхронизировано
          </span>
        )}
      </div>
    </div>
  )
}
