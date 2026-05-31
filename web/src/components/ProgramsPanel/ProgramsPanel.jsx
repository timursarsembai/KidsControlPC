import React, { useState, useCallback, useMemo, useEffect } from 'react'
import ConfirmModal from '../ConfirmModal'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { evaluateRule } from '@kidscontrol/shared/utils/timeHelpers'
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
  const { t } = useTranslation()
  const days = value?.weekdays || []
  const action = value?.action || 'block'
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
      <div className="action-select-wrap" style={{ marginTop: 8 }}>
        <Select 
          value={action}
          onChange={val => onChange({ ...value, action: val })}
          style={{ width: '100%' }}
          options={[
            { value: 'block', label: `🛑 ${t('programs.action_block', 'Блокировать в это время')}` },
            { value: 'allow', label: `✅ ${t('programs.action_allow', 'Разрешать только в это время')}` }
          ]}
        />
      </div>
    </div>
  )
}

function DateInput({ value, onChange }) {
  const { t } = useTranslation()
  const action = value?.action || 'block'
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
      <div className="action-select-wrap" style={{ marginTop: 8 }}>
        <Select 
          value={action}
          onChange={val => onChange({ ...value, action: val })}
          style={{ width: '100%' }}
          options={[
            { value: 'block', label: `🛑 ${t('programs.action_block', 'Блокировать в это время')}` },
            { value: 'allow', label: `✅ ${t('programs.action_allow', 'Разрешать только в это время')}` }
          ]}
        />
      </div>
    </div>
  )
}

function MonthlyDateInput({ value, onChange }) {
  const { t } = useTranslation()
  const action = value?.action || 'block'
  return (
    <div className="schedule-input-wrap" onClick={e => e.stopPropagation()}>
      <div className="time-range">
        <input type="number" className="input timer-input" min="1" max="31" placeholder={t('programs.day_placeholder', 'Число (1-31)')}
          value={value?.day || ''}
          onChange={e => onChange({ ...value, day: Number(e.target.value) })} />
      </div>
      <div className="time-range" style={{ marginTop: 8 }}>
        <input type="time" className="input time-input" value={value?.timeFrom || ''}
          onChange={e => onChange({ ...value, timeFrom: e.target.value })} />
        <span className="time-sep">—</span>
        <input type="time" className="input time-input" value={value?.timeTo || ''}
          onChange={e => onChange({ ...value, timeTo: e.target.value })} />
      </div>
      <div className="action-select-wrap" style={{ marginTop: 8 }}>
        <Select 
          value={action}
          onChange={val => onChange({ ...value, action: val })}
          style={{ width: '100%' }}
          options={[
            { value: 'block', label: `🛑 ${t('programs.action_block', 'Блокировать в это время')}` },
            { value: 'allow', label: `✅ ${t('programs.action_allow', 'Разрешать только в это время')}` }
          ]}
        />
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ProgramsPanel({ mode }) {
  const { t } = useTranslation()
  const {
    programSearch, setProgramSearch,
    programFilter, setProgramFilter,
    getFilteredPrograms,
    appsLoading,
    toggleProgramBlock, addProgramRule, sendDeviceCommand,
    selectedDeviceId, devices
  } = useRulesStore()

  const [showRunningOnly, setShowRunningOnly] = useState(false)

  const selectedDevice = devices.find(d => d.id === selectedDeviceId)
  const lastSeen = selectedDevice?.lastSeen?.toDate?.()
  const isOnline = selectedDevice?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000

  // Subscribe to store updates
  const installedApps = useRulesStore(state => state.installedApps)
  const rules = useRulesStore(state => state.rules)

  const [ruleData, setRuleData]         = useState({})
  const [pendingBlocks, setPendingBlocks] = useState(new Set()) // IDs being saved
  const [page, setPage] = useState(1)
  const [uninstallConfirmApp, setUninstallConfirmApp] = useState(null)
  
  const LIMIT = 50
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
    let apps = getFilteredPrograms()
    if (showRunningOnly) {
      apps = apps.filter(app => app.running)
    }
    return apps.map(app => {
      const rule = rules.find(r => r.type === 'program' && r.mode === mode && r.program.name === app.name)
      const evaluation = evaluateRule(rule, now)
      return {
        ...app,
        ruleId: rule?.id,
        rule: rule,
        isBlockedByTime: evaluation.isBlocked,
        statusText: evaluation.statusText,
        running: app.running || false
      }
    })
  }, [installedApps, rules, programSearch, programFilter, getFilteredPrograms, mode, now, showRunningOnly])

  // Auto-disable expired timers
  useEffect(() => {
    if (mode !== 'timer') return
    mergedApps.forEach(app => {
      if (app.blocked && app.statusText === 'Время вышло' && !pendingBlocks.has(app.id)) {
        if (app.ruleId) {
          toggleProgramBlock(app.ruleId, true)
        }
      }
    })
  }, [mergedApps, mode, pendingBlocks, toggleProgramBlock])

  // ── Block a program ──
  const handleBlock = useCallback(async (app) => {
    const conflict = useRulesStore.getState().checkRuleConflict('program', app.name, mode, app.ruleId)
    if (conflict) {
      alert(`Конфликт правил!\n\nПрограмма "${app.name}" уже используется в активном правиле (режим: ${conflict.mode === 'pomodoro' ? 'Помодоро' : conflict.mode}).\nСначала отключите то правило, чтобы запустить это.`)
      return
    }

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

  // ── Remote Uninstall ──
  const handleRemoteUninstall = useCallback(async (app) => {
    if (!app.uninstallCmd) {
      alert(t('programs.no_uninstall_cmd', 'Для этой программы не найдена команда удаления. Скорее всего она является системной или портативной.'))
      return
    }
    setUninstallConfirmApp(app)
  }, [t])

  const handleConfirmUninstall = useCallback(async () => {
    const app = uninstallConfirmApp
    setUninstallConfirmApp(null)
    if (!app) return

    try {
      await sendDeviceCommand({
        type: 'uninstall',
        appId: app.id,
        appName: app.name,
        uninstallCmd: app.uninstallCmd
      })
      alert(t('programs.uninstall_sent', 'Команда на удаление успешно отправлена на детский ПК. Выполнение может занять несколько секунд.'))
    } catch (err) {
      alert('Ошибка при отправке команды: ' + err.message)
    }
  }, [uninstallConfirmApp, sendDeviceCommand, t])

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
            placeholder={t('programs.search', 'Поиск программы...')}
            value={programSearch}
            onChange={e => setProgramSearch(e.target.value)} />
        </div>
        
        <Select 
          value={programFilter}
          onChange={val => setProgramFilter(val)}
          style={{ width: 220 }}
          options={[
            { value: 'all', label: t('programs.filter_all', 'Все программы') },
            { value: 'blocked', label: t('programs.filter_blocked', 'Заблокированы') },
            { value: 'unblocked', label: t('programs.filter_unblocked', 'Незаблокированы') }
          ]}
        />
        <button 
          className={`filter-btn ${showRunningOnly ? 'active' : ''}`}
          onClick={() => setShowRunningOnly(!showRunningOnly)}
          title="Показать только запущенные программы"
        >
          <span className="running-dot" />
          Только запущенные
        </button>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('programs.col_program', 'Программа')}</th>
              {mode === 'timer'    && <th>{t('programs.col_timer', 'Таймер')}</th>}
              {mode === 'schedule' && <th>{t('programs.col_schedule', 'Расписание')}</th>}
              {mode === 'date'     && <th>{t('programs.col_date', 'Единоразовая дата')}</th>}
              {mode === 'monthly_date' && <th>{t('programs.col_monthly_date', 'Число месяца')}</th>}
              <th style={{ width: 150 }}>Статус</th>
              <th style={{ width: 160 }}>Действие</th>
            </tr>
          </thead>
          <tbody>
            {appsLoading ? (
              <tr><td colSpan={colSpan}>
                <div className="empty-state">
                  <div className="loading-spinner" />
                  <span className="empty-state-title">{t('programs.loading_state', 'Загрузка программ с устройства...')}</span>
                  <span className="empty-state-desc">{t('programs.loading_desc', 'Синхронизируем базу данных приложений')}</span>
                </div>
              </td></tr>
            ) : mergedApps.length === 0 ? (
              <tr><td colSpan={colSpan}>
                <div className="empty-state">
                  <span className="empty-state-icon">🔍</span>
                  <span className="empty-state-title">{t('programs.empty_title', 'Ничего не найдено')}</span>
                  <span className="empty-state-desc">{t('programs.empty_desc', 'Убедитесь, что агент запущен на детском ПК и загрузил список программ')}</span>
                </div>
              </td></tr>
            ) : mergedApps.map(app => {
              const isPending = pendingBlocks.has(app.id)
              return (
                <tr key={app.id}>
                  {/* Name & path */}
                  <td>
                    <div className="prog-name-row">
                      <div className="prog-name">{app.name}</div>
                      {app.running && (
                        <span className="prog-running-badge">● Работает</span>
                      )}
                    </div>
                    {app.path
                      ? <div className="prog-path">{app.path}</div>
                      : <div className="prog-path no-path">{t('programs.path_unknown', 'Путь неизвестен')}</div>
                    }
                    {app.publisher && <div className="prog-publisher">{app.publisher}</div>}
                  </td>

                  {/* Dynamic column */}
                  {mode === 'timer' && (
                    <td>
                      <TimerInput value={ruleData[app.id]?.timer?.duration || app.rule?.timer?.duration || ''}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], timer: { duration: v } })} />
                    </td>
                  )}
                  {mode === 'schedule' && (
                    <td>
                      <ScheduleInput value={ruleData[app.id]?.schedule || app.rule?.schedule}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], schedule: v })} />
                    </td>
                  )}
                  {mode === 'date' && (
                    <td>
                      <DateInput value={ruleData[app.id]?.date || app.rule?.date}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], date: v })} />
                    </td>
                  )}
                  {mode === 'monthly_date' && (
                    <td>
                      <MonthlyDateInput value={ruleData[app.id]?.monthly_date || app.rule?.monthly_date}
                        onChange={v => updateRuleData(app.id, { ...ruleData[app.id], monthly_date: v })} />
                    </td>
                  )}

                  {/* Status badge */}
                  <td>
                    <div className="status-cell">
                      <span className={`status-dot ${app.blocked ? 'blocked' : 'unblocked'}`} />
                      <span className="status-text">
                        {app.blocked 
                          ? (app.isBlockedByTime ? t('programs.status_blocked', 'Заблокирован') : t('programs.status_waiting', 'Ожидание')) 
                          : t('programs.status_disabled', 'Отключен')}
                      </span>
                    </div>
                    {app.statusText && mode !== 'permanent' && (
                      <div className="countdown-text" style={{ fontSize: '0.75rem', color: '#8b8d98', marginTop: 2 }}>
                        {app.statusText}
                      </div>
                    )}
                  </td>

                  {/* Action */}
                  <td>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        className={`btn btn-sm ${app.blocked ? 'btn-success' : 'btn-danger'}`}
                        disabled={isPending}
                        onClick={() => app.blocked ? handleUnblock(app) : handleBlock(app)}
                        style={{ flex: 1 }}
                      >
                        {isPending
                          ? <span className="btn-spinner-sm" />
                          : app.blocked ? t('programs.btn_disable', 'Отключить правило') : t('programs.btn_enable', 'Включить правило')
                        }
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ padding: '0 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-danger)', fontSize: '1rem' }}
                        title={t('programs.btn_uninstall', 'Удалить программу с ПК')}
                        onClick={() => handleRemoteUninstall(app)}
                      >
                        🗑️
                      </button>
                    </div>
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
            ? t('programs.loading', 'Загрузка...')
            : `${mergedApps.filter(a => a.blocked).length} из ${mergedApps.length} ${t('programs.blocked_word', 'заблокировано')}`
          }
        </span>
        {!appsLoading && (
          <span className="footer-hint">
            {installedApps.length} {t('programs.synced_count', 'программ синхронизировано')}
          </span>
        )}
      </div>
      
      <ConfirmModal
        isOpen={!!uninstallConfirmApp}
        title="Удаление программы"
        message={t('programs.confirm_uninstall', 'Вы уверены, что хотите УДАЛЕННО УДАЛИТЬ программу "{{name}}" с компьютера ребенка?\n\nВнимание: Это действие может быть необратимым!', { name: uninstallConfirmApp?.name })}
        confirmText="Удалить"
        confirmDanger={true}
        onConfirm={handleConfirmUninstall}
        onCancel={() => setUninstallConfirmApp(null)}
      />
    </div>
  )
}

