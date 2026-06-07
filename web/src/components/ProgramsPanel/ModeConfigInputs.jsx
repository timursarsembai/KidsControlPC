import { useTranslation } from 'react-i18next'
import Select from '../Select/Select'
import TimeInput from '../TimeInput/TimeInput'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function TimerInput({ value, onChange }) {
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

export function ScheduleInput({ value, onChange }) {
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

export function DateInput({ value, onChange }) {
  const { t } = useTranslation()
  const action = value?.action || 'block'
  return (
    <div className="schedule-input-wrap" onClick={e => e.stopPropagation()}>
      <input type="date" className="input date-input" value={value?.date || ''}
        onChange={e => onChange({ ...value, date: e.target.value })} />
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

export function MonthlyDateInput({ value, onChange }) {
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
