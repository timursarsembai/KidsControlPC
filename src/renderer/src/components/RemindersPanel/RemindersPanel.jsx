import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import Select from '../Select/Select'
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

function DateInput({ value, onChange }) {
  return (
    <div className="schedule-input-wrap">
      <input type="date" className="input date-input" value={value?.date || ''}
        onChange={e => onChange({ ...value, date: e.target.value })} />
      <div className="time-range">
        <input type="time" className="input time-input" value={value?.timeFrom || ''}
          onChange={e => onChange({ ...value, timeFrom: e.target.value })} />
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
  
  const [mode, setMode] = useState('date') // 'date', 'schedule', 'monthly_date'
  const [dateVal, setDateVal] = useState({ date: '', timeFrom: '' })
  const [schedVal, setSchedVal] = useState({ weekdays: [], timeFrom: '' })
  const [monthlyVal, setMonthlyVal] = useState({ day: '', timeFrom: '' })

  const handleAdd = async () => {
    if (!message.trim()) return alert('Введите текст напоминания')
    
    let modeConfig = {}
    if (mode === 'date') {
      if (!dateVal.date || !dateVal.timeFrom) return alert('Укажите дату и время')
      modeConfig.date = dateVal
    } else if (mode === 'schedule') {
      if (schedVal.weekdays.length === 0 || !schedVal.timeFrom) return alert('Укажите дни недели и время')
      modeConfig.schedule = schedVal
    } else if (mode === 'monthly_date') {
      if (!monthlyVal.day || !monthlyVal.timeFrom) return alert('Укажите число и время')
      modeConfig.monthly_date = monthlyVal
    }

    await addReminderRule(message, { voiceLoop, systemNotification }, modeConfig)
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
      const daysStr = r.schedule.weekdays.map(d => DAYS[d]).join(', ')
      return `Каждую неделю: ${daysStr} в ${r.schedule.timeFrom}`
    } else if (r.mode === 'monthly_date' && r.monthly_date) {
      return `Каждый месяц: ${r.monthly_date.day}-го числа в ${r.monthly_date.timeFrom}`
    }
    return 'Неизвестное расписание'
  }

  return (
    <div className="reminders-panel">
      <div className="reminders-header">
        <h2 className="reminders-title">Напоминания и будильники 🔔</h2>
      </div>

      <div className="reminder-form">
        <div className="form-group">
          <label>Текст напоминания</label>
          <textarea 
            className="message-textarea" 
            placeholder="Например: Пора делать уроки!"
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
        </div>
        
        <div className="reminder-settings">
          <label className="setting-row" style={{cursor:'pointer'}}>
            <input type="checkbox" checked={voiceLoop} onChange={e => setVoiceLoop(e.target.checked)} />
            Непрерывная голосовая озвучка (ребёнку придется нажать кнопку Отключить, чтобы звук прекратился)
          </label>
          <label className="setting-row" style={{cursor:'pointer'}}>
            <input type="checkbox" checked={systemNotification} onChange={e => setSystemNotification(e.target.checked)} />
            Показывать системное уведомление Windows
          </label>
        </div>

        <div className="form-group">
          <label>Тип расписания</label>
          <Select 
            value={mode} 
            onChange={setMode} 
            options={[
              { value: 'date', label: 'Разово (в точную дату и время)' },
              { value: 'schedule', label: 'Еженедельно (по дням недели)' },
              { value: 'monthly_date', label: 'Ежемесячно (по числам)' }
            ]} 
          />
        </div>

        <div className="form-group">
          {mode === 'date' && <DateInput value={dateVal} onChange={setDateVal} />}
          {mode === 'schedule' && <ScheduleInput value={schedVal} onChange={setSchedVal} />}
          {mode === 'monthly_date' && <MonthlyDateInput value={monthlyVal} onChange={setMonthlyVal} />}
        </div>

        <div className="form-actions">
          <button className="btn btn-primary reminder-add-btn" onClick={handleAdd}>
            + Создать напоминание
          </button>
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
                {r.voiceLoop && <span title="Голосовая озвучка">🔊 Озвучка</span>}
                {r.systemNotification && <span title="Уведомление Windows">💬 Системное уведомление</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
