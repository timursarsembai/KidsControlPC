import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { evaluateRule } from '@kidscontrol/shared/utils/timeHelpers'
import Select from '../Select/Select'
import ProgramRow from './ProgramRow'
import './ProgramsPanel.css'

// ─── Main component ──────────────────────────────────────────────────────────
export default function ProgramsPanel({ mode }) {
  const { t } = useTranslation()
  const {
    programSearch, setProgramSearch,
    programFilter, setProgramFilter,
    getFilteredPrograms,
    appsLoading,
    toggleProgramBlock, addProgramRule, sendDeviceCommand
  } = useRulesStore()

  const [showRunningOnly, setShowRunningOnly] = useState(false)

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
    const confirmMsg = t('programs.confirm_uninstall', 'Вы уверены, что хотите УДАЛЕННО УДАЛИТЬ программу "{{name}}" с компьютера ребенка?\\n\\nВнимание: Это действие может быть необратимым!', { name: app.name }).replace(/\\n/g, '\n')
    if (!window.confirm(confirmMsg)) return

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
  }, [sendDeviceCommand, t])

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
            ) : mergedApps.map(app => (
              <ProgramRow
                key={app.id}
                app={app}
                mode={mode}
                t={t}
                isPending={pendingBlocks.has(app.id)}
                ruleData={ruleData}
                updateRuleData={updateRuleData}
                onBlock={handleBlock}
                onUnblock={handleUnblock}
                onRemoteUninstall={handleRemoteUninstall}
              />
            ))}
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
    </div>
  )
}

