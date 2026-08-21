import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import { evaluateRule } from '@kidscontrol/shared/utils/timeHelpers'
import Select from '@kidscontrol/shared/ui/Select'
import TimeInput from '@kidscontrol/shared/ui/TimeInput'

import './WebPanel.css'



const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function ScheduleCell({ value, onChange }) {
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
        <TimeInput value={value?.timeFrom || ''}
          onChange={timeFrom => onChange({ ...value, timeFrom })} />
        <span className="time-sep">—</span>
        <TimeInput value={value?.timeTo || ''}
          onChange={timeTo => onChange({ ...value, timeTo })} />
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

export default function WebPanel({ mode }) {
  const { t } = useTranslation()
  const { addWebsite, toggleWebsiteBlock, removeWebsiteGlobally, getFilteredWebsites, rules } = useRulesStore()
  const websites = getFilteredWebsites()
  const [urlInput, setUrlInput] = useState('')

  const [error, setError]       = useState('')
  const [webRuleData, setWebRuleData] = useState({})
  const [pendingBlocks, setPendingBlocks] = useState(new Set())
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const mergedWebsites = websites.map(site => {
    const rule = rules.find(r => r.id === site.id)
    const evaluation = evaluateRule(rule, now)
    return { ...site, evaluation, rule }
  })

  // Auto-disable expired timers
  useEffect(() => {
    if (mode !== 'timer') return
    mergedWebsites.forEach(site => {
      if (site.blocked && site.evaluation?.statusText === 'Время вышло') {
        toggleWebsiteBlock(site.id, true, webRuleData[site.id] || {})
      }
    })
  }, [mergedWebsites, mode, toggleWebsiteBlock, webRuleData])

  const resolvePattern = (url) => {
    try {
      const cleaned = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      return cleaned.split('/')[0]
    } catch { return url }
  }

  const handleAdd = () => {
    if (!urlInput.trim()) { setError('Введите URL'); return }
    const resolved = resolvePattern(urlInput.trim())
    const conflict = useRulesStore.getState().checkRuleConflict('web', resolved, mode)
    if (conflict) {
      setError(`Ресурс уже блокируется (режим: ${conflict.mode === 'pomodoro' ? 'Помодоро' : conflict.mode})`)
      return
    }
    setError('')
    addWebsite({
      inputUrl: urlInput.trim(),
      scope: 'domain',
      resolvedPattern: resolvePattern(urlInput.trim())
    })
    setUrlInput('')
  }

  const updateWebRule = (id, val) => {
    setWebRuleData(prev => ({ ...prev, [id]: val }))
  }

  const handleBlock = async (site) => {
    const conflict = useRulesStore.getState().checkRuleConflict('web', site.resolvedPattern, mode, site.ruleId)
    if (conflict) {
      alert(`Конфликт правил!\n\nРесурс "${site.resolvedPattern}" уже используется в активном правиле (режим: ${conflict.mode === 'pomodoro' ? 'Помодоро' : conflict.mode}).\nСначала отключите то правило.`)
      return
    }

    setPendingBlocks(prev => new Set([...prev, site.id]))
    try {
      if (site.ruleId) {
        await toggleWebsiteBlock(site.ruleId, site.blocked, webRuleData[site.id] || {})
      } else {
        await addWebsite(site, webRuleData[site.id] || {})
      }
    } finally {
      setPendingBlocks(prev => { const s = new Set(prev); s.delete(site.id); return s })
    }
  }

  const handleUnblock = async (site) => {
    if (!site.ruleId) return
    setPendingBlocks(prev => new Set([...prev, site.id]))
    try {
      await toggleWebsiteBlock(site.ruleId, true, webRuleData[site.id] || {})
    } finally {
      setPendingBlocks(prev => { const s = new Set(prev); s.delete(site.id); return s })
    }
  }

  return (
    <div className="web-panel animate-in">
      {/* ── Add form ── */}
      <div className="web-add-card">
        <div className="web-add-header">
          <span className="web-add-title">{t('web.add_title', 'Добавить веб-ресурс')}</span>
          <span className="web-add-hint">{t('web.add_hint', 'Добавленный ресурс сразу блокируется')}</span>
        </div>
        <div className="web-add-form">
          <div className="url-input-wrap">
            <span className="url-prefix">🌐</span>
            <input
              type="text"
              className={`input url-input ${error ? 'input-error' : ''}`}
              placeholder={t('web.placeholder', 'youtube.com или vk.com')}
              value={urlInput}
              onChange={e => { setUrlInput(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>

          <button className="btn btn-primary add-btn" onClick={handleAdd}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Добавить
          </button>
        </div>
        {error && <div className="input-error-msg">{error}</div>}
        {urlInput && (
          <div className="scope-preview">
            <span>🔒 {t('web.domain_blocked', 'Будет заблокирован весь домен:')} <strong>{resolvePattern(urlInput)}</strong></span>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('web.col_web', 'Веб-ресурс')}</th>

              {mode === 'timer'    && <th>{t('programs.col_timer', 'Таймер')}</th>}
              {mode === 'schedule' && <th>{t('programs.col_schedule', 'Расписание')}</th>}
              {mode === 'date'     && <th>{t('programs.col_date', 'Единоразовая дата')}</th>}
              {mode === 'monthly_date' && <th>{t('programs.col_monthly_date', 'Число месяца')}</th>}
              <th style={{ width: 140 }}>Действие</th>
            </tr>
          </thead>
          <tbody>
            {mergedWebsites.length === 0 ? (
              <tr>
                <td colSpan={mode === 'permanent' ? 2 : 3}>
                  <div className="empty-state">
                    <span className="empty-state-icon">🌐</span>
                    <span className="empty-state-title">{t('web.empty_title', 'Нет добавленных ресурсов')}</span>
                    <span className="empty-state-desc">{t('web.empty_desc', 'Введите URL выше и нажмите «Добавить»')}</span>
                  </div>
                </td>
              </tr>
            ) : mergedWebsites.map(site => (
              <tr key={site.id}>
                <td>
                  <div className="site-url">{site.inputUrl}</div>
                  {site.resolvedPattern !== site.inputUrl &&
                    <div className="site-pattern">→ {t('web.blocked_arrow', 'блокируется:')} {site.resolvedPattern}</div>}
                  {site.evaluation.statusText && mode !== 'permanent' && (
                    <div className="countdown-text" style={{ fontSize: '0.75rem', color: '#8b8d98', marginTop: 2 }}>
                      {site.evaluation.statusText}
                    </div>
                  )}
                </td>


                {mode === 'timer' && (
                  <td>
                    <div className="timer-input-wrap" onClick={e => e.stopPropagation()}>
                      <input type="number" className="input timer-input"
                        placeholder="мин" min="1" max="1440"
                        value={webRuleData[site.id]?.timer?.duration || site.rule?.timer?.duration || ''}
                        onChange={e => updateWebRule(site.id, { ...webRuleData[site.id], timer: { duration: e.target.value } })}
                      />
                      <span className="timer-unit">мин</span>
                    </div>
                  </td>
                )}
                {mode === 'schedule' && (
                  <td>
                    <ScheduleCell
                      value={webRuleData[site.id]?.schedule || site.rule?.schedule}
                      onChange={v => updateWebRule(site.id, { ...webRuleData[site.id], schedule: v })}
                    />
                  </td>
                )}
                {mode === 'date' && (
                  <td onClick={e => e.stopPropagation()}>
                    <div className="schedule-input-wrap">
                      <input type="date" className="input date-input"
                        value={webRuleData[site.id]?.date?.date || site.rule?.date?.date || ''}
                        onChange={e => updateWebRule(site.id, { ...webRuleData[site.id], date: { ...(webRuleData[site.id]?.date || site.rule?.date), date: e.target.value } })}
                      />
                      <div className="time-range">
                        <TimeInput
                          value={webRuleData[site.id]?.date?.timeFrom || site.rule?.date?.timeFrom || ''}
                          onChange={timeFrom => updateWebRule(site.id, { ...webRuleData[site.id], date: { ...(webRuleData[site.id]?.date || site.rule?.date), timeFrom } })} />
                        <span className="time-sep">—</span>
                        <TimeInput
                          value={webRuleData[site.id]?.date?.timeTo || site.rule?.date?.timeTo || ''}
                          onChange={timeTo => updateWebRule(site.id, { ...webRuleData[site.id], date: { ...(webRuleData[site.id]?.date || site.rule?.date), timeTo } })} />
                      </div>
                      <div className="action-select-wrap" style={{ marginTop: 8 }}>
                        <Select 
                          value={webRuleData[site.id]?.date?.action || site.rule?.date?.action || 'block'}
                          onChange={val => updateWebRule(site.id, { ...webRuleData[site.id], date: { ...(webRuleData[site.id]?.date || site.rule?.date), action: val } })}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'block', label: `🛑 ${t('programs.action_block', 'Блокировать в это время')}` },
                            { value: 'allow', label: `✅ ${t('programs.action_allow', 'Разрешать только в это время')}` }
                          ]}
                        />
                      </div>
                    </div>
                  </td>
                )}
                {mode === 'monthly_date' && (
                  <td onClick={e => e.stopPropagation()}>
                    <div className="schedule-input-wrap">
                      <div className="time-range">
                        <input type="number" className="input timer-input" min="1" max="31" placeholder={t('programs.day_placeholder', 'Число (1-31)')}
                          value={webRuleData[site.id]?.monthly_date?.day || site.rule?.monthly_date?.day || ''}
                          onChange={e => updateWebRule(site.id, { ...webRuleData[site.id], monthly_date: { ...(webRuleData[site.id]?.monthly_date || site.rule?.monthly_date), day: Number(e.target.value) } })} />
                      </div>
                      <div className="time-range" style={{ marginTop: 8 }}>
                        <TimeInput
                          value={webRuleData[site.id]?.monthly_date?.timeFrom || site.rule?.monthly_date?.timeFrom || ''}
                          onChange={timeFrom => updateWebRule(site.id, { ...webRuleData[site.id], monthly_date: { ...(webRuleData[site.id]?.monthly_date || site.rule?.monthly_date), timeFrom } })} />
                        <span className="time-sep">—</span>
                        <TimeInput
                          value={webRuleData[site.id]?.monthly_date?.timeTo || site.rule?.monthly_date?.timeTo || ''}
                          onChange={timeTo => updateWebRule(site.id, { ...webRuleData[site.id], monthly_date: { ...(webRuleData[site.id]?.monthly_date || site.rule?.monthly_date), timeTo } })} />
                      </div>
                      <div className="action-select-wrap" style={{ marginTop: 8 }}>
                        <Select 
                          value={webRuleData[site.id]?.monthly_date?.action || site.rule?.monthly_date?.action || 'block'}
                          onChange={val => updateWebRule(site.id, { ...webRuleData[site.id], monthly_date: { ...(webRuleData[site.id]?.monthly_date || site.rule?.monthly_date), action: val } })}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'block', label: `🛑 ${t('programs.action_block', 'Блокировать в это время')}` },
                            { value: 'allow', label: `✅ ${t('programs.action_allow', 'Разрешать только в это время')}` }
                          ]}
                        />
                      </div>
                    </div>
                  </td>
                )}

                <td>
                  <div className="action-btns">
                    <button
                      className={`btn btn-sm ${site.blocked ? 'btn-success' : 'btn-danger'}`}
                      disabled={pendingBlocks.has(site.id)}
                      onClick={() => site.blocked ? handleUnblock(site) : handleBlock(site)}
                    >
                      {pendingBlocks.has(site.id) ? <span className="btn-spinner-sm" /> : (site.blocked ? t('programs.btn_disable', 'Отключить правило') : t('programs.btn_enable', 'Включить правило'))}
                    </button>
                    <button
                      className="btn btn-icon btn-sm"
                      title="Удалить из всех списков"
                      onClick={() => removeWebsiteGlobally(site.resolvedPattern)}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-footer">
        <span className="footer-count">
          {websites.filter(w => w.blocked).length} {t('programs.of', 'из')} {websites.length} {t('programs.blocked_word', 'заблокировано')}
        </span>
      </div>
    </div>
  )
}

