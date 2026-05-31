import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './RemindersPanel.css'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function ScheduleInput({ value, onChange }) {
  const days = value?.weekdays || []
  const toggleDay = (i) => {
    const next = days.includes(i) ? days.filter(d => d !== i) : [...days, i]
    onChange({ ...value, weekdays: next })
  }
  return (
    <div className="schedule-input-wrap">
      <div className="checkbox-group">
        {DAYS.map((d, i) => (
          <label key={i} className={`day-label ${days.includes(i) ? 'checked' : ''}`}
            onClick={() => toggleDay(i)}>{d}</label>
        ))}
      </div>
      <div className="time-range">
        <input type="time" className="input time-input" value={value?.timeFrom || ''}
          onChange={e => onChange({ ...value, timeFrom: e.target.value })} />
      </div>
    </div>
  )
}

function TimeOnlyInput({ value, onChange }) {
  return (
    <div className="schedule-input-wrap">
      <div className="time-range">
        <input type="time" className="input time-input" value={value || ''}
          onChange={e => onChange(e.target.value)} />
      </div>
    </div>
  )
}

function MonthlyDateInput({ value, onChange }) {
  const { t } = useTranslation()
  return (
    <div className="schedule-input-wrap">
      <div className="time-range">
        <input type="number" className="input timer-input" min="1" max="31" placeholder={t('programs.day_placeholder', 'Число (1-31)')}
          value={value?.day || ''}
          onChange={e => onChange({ ...value, day: Number(e.target.value) })} />
      </div>
      <div className="time-range" style={{ marginTop: 8 }}>
        <input type="time" className="input time-input" value={value?.timeFrom || ''}
          onChange={e => onChange({ ...value, timeFrom: e.target.value })} />
      </div>
    </div>
  )
}

export default function RemindersPanel() {
  const { rules, addReminderRule, removeRule } = useRulesStore()
  const reminders = rules.filter(r => r.type === 'reminder')

  const [message, setMessage] = useState('')
  const [voiceLoop, setVoiceLoop] = useState(false)
  const [systemNotification, setSystemNotification] = useState(false)
  
  const [mode, setMode] = useState('once') // 'once', 'weekly', 'monthly'
  const [timeOnce, setTimeOnce] = useState('')
  const [repeatDaily, setRepeatDaily] = useState(false)
  const [schedVal, setSchedVal] = useState({ weekdays: [], timeFrom: '' })
  const [monthlyVal, setMonthlyVal] = useState({ day: '', timeFrom: '' })

  const handleAdd = async () => {
    if (!message.trim()) return alert('Введите текст напоминания')
    
    let modeConfig = {}
    let payloadMode = 'date'

    if (mode === 'once') {
      if (!timeOnce) return alert('Укажите время')
      
      if (repeatDaily) {
        payloadMode = 'schedule'
        modeConfig.schedule = { weekdays: [0, 1, 2, 3, 4, 5, 6], timeFrom: timeOnce, timeTo: timeOnce }
      } else {
        payloadMode = 'date'
        // Calculate today or tomorrow based on time
        const now = new Date()
        const [h, m] = timeOnce.split(':').map(Number)
        const cur = now.getHours() * 60 + now.getMinutes()
        const schedTime = h * 60 + m
        
        const targetDate = new Date(now)
        if (schedTime <= cur) {
          targetDate.setDate(targetDate.getDate() + 1) // tomorrow
        }
        
        const y = targetDate.getFullYear()
        const mo = String(targetDate.getMonth() + 1).padStart(2, '0')
        const d = String(targetDate.getDate()).padStart(2, '0')
        
        modeConfig.date = { date: `${y}-${mo}-${d}`, timeFrom: timeOnce, timeTo: timeOnce }
      }
    } else if (mode === 'weekly') {
      if (schedVal.weekdays.length === 0 || !schedVal.timeFrom) return alert('Укажите дни недели и время')
      payloadMode = 'schedule'
      modeConfig.schedule = { ...schedVal, timeTo: schedVal.timeFrom }
    } else if (mode === 'monthly') {
      if (!monthlyVal.day || !monthlyVal.timeFrom) return alert('Укажите число и время')
      payloadMode = 'monthly_date'
      modeConfig.monthly_date = { ...monthlyVal, timeTo: monthlyVal.timeFrom }
    }

    await addReminderRule(message, { voiceLoop, systemNotification }, { [payloadMode]: modeConfig[payloadMode] })
    setMessage('')
  }

  const handleDelete = (id) => {
    if (confirm('Удалить напоминание?')) {
      removeRule(id)
    }
  }

  const formatSchedule = (r) => {
    if (r.mode === 'date' && r.date) {
      return `Разово: ${r.date.date} в ${r.date.timeFrom}`
    } else if (r.mode === 'schedule' && r.schedule) {
      if (r.schedule.weekdays?.length === 7) {
        return `Ежедневно в ${r.schedule.timeFrom}`
      }
      const daysStr = (r.schedule.weekdays || []).map(d => DAYS[d]).join(', ')
      return `Каждую неделю: ${daysStr} в ${r.schedule.timeFrom}`
    } else if (r.mode === 'monthly_date' && r.monthly_date) {
      return `Каждый месяц: ${r.monthly_date.day}-го числа в ${r.monthly_date.timeFrom}`
    }
    return 'Неизвестное расписание'
  }

  return (
    <div className="reminders-panel">
      <div className="reminders-header">
        <h2 className="reminders-title">Напоминания 🔔</h2>
      </div>

      <div className="reminder-form">
        <div className="reminder-form-left">
          <div className="form-group" style={{ height: '100%', display: 'flex' }}>
            <label>Текст напоминания</label>
            <textarea 
              className="message-textarea" 
              placeholder="Например: Пора делать уроки!"
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>
        </div>
        
        <div className="reminder-form-right">
          <div className="form-group">
            <label>Тип расписания</label>
            <div className="schedule-tabs">
              <button className={`schedule-tab ${mode === 'once' ? 'active' : ''}`} onClick={() => setMode('once')}>Единоразово</button>
              <button className={`schedule-tab ${mode === 'weekly' ? 'active' : ''}`} onClick={() => setMode('weekly')}>Еженедельно</button>
              <button className={`schedule-tab ${mode === 'monthly' ? 'active' : ''}`} onClick={() => setMode('monthly')}>Ежемесячно</button>
            </div>
          </div>

          <div className="form-group">
            {mode === 'once' && (
              <>
                <TimeOnlyInput value={timeOnce} onChange={setTimeOnce} />
                <label className="setting-row">
                  <label className="switch">
                    <input type="checkbox" checked={repeatDaily} onChange={e => setRepeatDaily(e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                  Повторять ежедневно
                </label>
              </>
            )}
            {mode === 'weekly' && <ScheduleInput value={schedVal} onChange={setSchedVal} />}
            {mode === 'monthly' && <MonthlyDateInput value={monthlyVal} onChange={setMonthlyVal} />}
          </div>

          <div className="reminder-settings">
            <label className="setting-row">
              <label className="switch">
                <input type="checkbox" checked={voiceLoop} onChange={e => setVoiceLoop(e.target.checked)} />
                <span className="slider"></span>
              </label>
              Непрерывная голосовая озвучка
            </label>
            <label className="setting-row">
              <label className="switch">
                <input type="checkbox" checked={systemNotification} onChange={e => setSystemNotification(e.target.checked)} />
                <span className="slider"></span>
              </label>
              Короткий звук сирены
            </label>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary reminder-add-btn" onClick={handleAdd}>
              + Создать напоминание
            </button>
          </div>
        </div>
      </div>

      <div className="reminders-list">
        {reminders.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>Нет активных напоминаний</p>
        ) : (
          reminders.map(r => (
            <div key={r.id} className="reminder-card">
              <div className="reminder-top">
                <div className="reminder-info">
                  <div className="reminder-message">{r.message}</div>
                  <div className="reminder-schedule">
                    🕒 {formatSchedule(r)}
                  </div>
                </div>
                <div className="reminder-actions">
                  <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleDelete(r.id)}>Удалить</button>
                </div>
              </div>
              <div className="setting-row" style={{ marginTop: 8 }}>
                {r.voiceLoop && <span title="Голосовая озвучка">🔊 Непрерывная озвучка</span>}
                {r.systemNotification && <span title="Звук сирены">🚨 Звук сирены</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
