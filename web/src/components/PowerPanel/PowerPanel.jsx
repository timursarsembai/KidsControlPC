import React, { useState, useEffect, useMemo } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ConfirmModal from '../ConfirmModal'
import TimeInput from '@kidscontrol/shared/ui/TimeInput'
import './PowerPanel.css'

const COLORS = [
  { label: 'Черный', value: '#000000' },
  { label: 'Темно-серый', value: '#1C1C1C' },
  { label: 'Темно-синий', value: '#0A192F' },
  { label: 'Темно-красный', value: '#2D0A0A' },
  { label: 'Фиолетовый', value: '#1A0B2E' },
  { label: 'Темно-зеленый', value: '#092113' }
]

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const ICON_PATHS = {
  power:     <path d="M7.5 2v6M4.4 4.3a5 5 0 1 0 6.2 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>,
  refresh:   <path d="M12.5 7.5a5 5 0 1 1-1.46-3.54M12.5 2v2.5H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  moon:      <path d="M12 9.3A5 5 0 1 1 6.2 3 4 4 0 0 0 12 9.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/>,
  snowflake: <path d="M7.5 1.5v12M2.3 4.5l10.4 6M12.7 4.5l-10.4 6M7.5 1.5l-2 1.6m2-1.6l2 1.6M7.5 13.5l-2-1.6m2 1.6l2-1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>,
  clockOff:  <path d="M7.5 1.5a6 6 0 0 1 6 6M13 13L2 2m4.4 1.7A6 6 0 0 0 11.3 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>,
  plus:      <path d="M7.5 3v9M3 7.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>,
  x:         <path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>,
}

function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      {ICON_PATHS[name]}
    </svg>
  )
}

const ACTION_META = {
  shutdown:  { label: 'Выключить',     icon: 'power',     color: 'danger' },
  restart:   { label: 'Перезагрузить', icon: 'refresh',   color: 'warning' },
  sleep:     { label: 'Спящий режим',  icon: 'moon',      color: 'sleep' },
  hibernate: { label: 'Гибернация',    icon: 'snowflake', color: 'info' },
}

function getNextFireTime(rule, now) {
  if (rule.mode === 'schedule' && rule.schedule) {
    const [h, m] = (rule.schedule.timeFrom || '00:00').split(':').map(Number)
    const weekdays = rule.schedule.weekdays || rule.schedule.groups?.[0]?.weekdays || [0,1,2,3,4,5,6]
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now)
      candidate.setDate(candidate.getDate() + offset)
      candidate.setHours(h, m, 0, 0)
      const dow = (candidate.getDay() + 6) % 7
      if (weekdays.includes(dow) && candidate > now) return candidate
    }
  }
  if (rule.mode === 'monthly_date' && rule.monthly_date) {
    const [h, m] = (rule.monthly_date.timeFrom || '00:00').split(':').map(Number)
    const candidate = new Date(now)
    candidate.setDate(rule.monthly_date.day)
    candidate.setHours(h, m, 0, 0)
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1)
    return candidate
  }
  if (rule.mode === 'date' && rule.date) {
    const candidate = new Date(rule.date.date)
    const [h, m] = (rule.date.timeFrom || '00:00').split(':').map(Number)
    candidate.setHours(h, m, 0, 0)
    if (candidate > now) return candidate
  }
  return null
}

function formatCountdown(ms) {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 1) return 'менее минуты'
  if (totalMin < 60) return `через ${totalMin} мин`
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min > 0 ? `через ${h} ч ${min} мин` : `через ${h} ч`
}

function formatRuleTime(rule) {
  if (rule.mode === 'schedule') return rule.schedule?.timeFrom || '—'
  if (rule.mode === 'monthly_date') return rule.monthly_date?.timeFrom || '—'
  if (rule.mode === 'date') return rule.date?.timeFrom || '—'
  return '—'
}

function formatRuleDays(rule) {
  if (rule.mode === 'schedule') {
    const wd = rule.schedule?.weekdays || rule.schedule?.groups?.[0]?.weekdays
    if (!wd || wd.length === 7) return 'Ежедневно'
    return wd.map(d => DAYS[d]).join(', ')
  }
  if (rule.mode === 'monthly_date') return `Каждый месяц ${rule.monthly_date?.day}-го числа`
  if (rule.mode === 'date') return `Однократно: ${rule.date?.date}`
  return ''
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PowerPanel({ mode = 'power' }) {
  const {
    sendDeviceCommand, updateDeviceSettings,
    selectedDeviceId, devices, rules,
    addPowerRule, removeRule
  } = useRulesStore()

  const selectedDevice = devices.find(d => d.id === selectedDeviceId)

  // Lock screen state
  const [lockMessage, setLockMessage] = useState('Время вышло! Компьютер заблокирован.')
  const [lockColor, setLockColor] = useState('#000000')
  const [lockPin, setLockPin] = useState('')
  const [playSound, setPlaySound] = useState(true)
  const [readMessage, setReadMessage] = useState(false)
  const [readMessageRepeat, setReadMessageRepeat] = useState(false)

  // Command state
  const [sendingAction, setSendingAction] = useState(null)
  const [successAction, setSuccessAction] = useState(null)
  const [offlineConfirmAction, setOfflineConfirmAction] = useState(null)

  // Schedule form state
  const [showForm, setShowForm] = useState(false)
  const [schedAction, setSchedAction] = useState('shutdown')
  const [schedMode, setSchedMode] = useState('daily')
  const [schedTime, setSchedTime] = useState('')
  const [schedWeekdays, setSchedWeekdays] = useState([0,1,2,3,4,5,6])
  const [schedMonthDay, setSchedMonthDay] = useState('')
  const [schedSaving, setSchedSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const [nowMs, setNowMs] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (selectedDevice) {
      if (selectedDevice.lockMessage !== undefined) setLockMessage(selectedDevice.lockMessage)
      if (selectedDevice.lockColor !== undefined) setLockColor(selectedDevice.lockColor)
      if (selectedDevice.lockPin !== undefined) setLockPin(selectedDevice.lockPin)
      if (selectedDevice.playSound !== undefined) setPlaySound(selectedDevice.playSound)
      if (selectedDevice.readMessage !== undefined) setReadMessage(selectedDevice.readMessage)
      if (selectedDevice.readMessageRepeat !== undefined) setReadMessageRepeat(selectedDevice.readMessageRepeat)
    }
  }, [selectedDevice])

  const isOnline = selectedDevice?.status !== 'offline' && selectedDevice?.lastSeen &&
    (nowMs - selectedDevice.lastSeen.toDate().getTime()) < 2 * 60 * 1000

  const powerScheduleRules = useMemo(
    () => rules.filter(r => r.type === 'power' && r.mode !== 'permanent'),
    [rules]
  )

  const nextEvent = useMemo(() => {
    const now = new Date(nowMs)
    let best = null, bestRule = null
    for (const r of powerScheduleRules) {
      const t = getNextFireTime(r, now)
      if (t && (!best || t < best)) { best = t; bestRule = r }
    }
    return best ? { time: best, rule: bestRule } : null
  }, [powerScheduleRules, nowMs])

  const handleCommand = async (action) => {
    if (!isOnline) { setOfflineConfirmAction(action); return }
    await executeCommand(action)
  }

  const handleConfirmOffline = async () => {
    const action = offlineConfirmAction
    setOfflineConfirmAction(null)
    if (action) await executeCommand(action)
  }

  const executeCommand = async (action) => {
    setSendingAction(action)
    try {
      if (action === 'lock') {
        await updateDeviceSettings({ isLocked: true, lockMessage, lockColor, lockPin, playSound, readMessage, readMessageRepeat })
      } else if (action === 'unlock') {
        await updateDeviceSettings({ isLocked: false })
      } else if (action === 'update_agent') {
        await updateDeviceSettings({ forceUpdateRequestedAtMs: Date.now() })
      }
      const payload = { action }
      if (action === 'lock') {
        Object.assign(payload, { message: lockMessage, color: lockColor, pin: lockPin, playSound, readMessage, readMessageRepeat })
      }
      if (!['lock', 'unlock', 'update_agent'].includes(action)) {
        await sendDeviceCommand(payload)
      }
      setSuccessAction(action)
      setTimeout(() => setSuccessAction(null), 2500)
    } catch (e) {
      alert('Ошибка при отправке команды: ' + e.message)
    } finally {
      setSendingAction(null)
    }
  }

  const toggleSchedDay = (i) => {
    setSchedWeekdays(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])
  }

  const handleAddSchedule = async () => {
    if (!schedTime) return alert('Укажите время')
    if (schedMode === 'weekly' && schedWeekdays.length === 0) return alert('Выберите хотя бы один день недели')
    if (schedMode === 'monthly' && !schedMonthDay) return alert('Укажите число месяца')
    setSchedSaving(true)
    try {
      if (schedMode === 'daily') {
        await addPowerRule(schedAction, 'schedule', {
          schedule: { action: 'block', weekdays: [0,1,2,3,4,5,6], timeFrom: schedTime, timeTo: schedTime }
        })
      } else if (schedMode === 'weekly') {
        await addPowerRule(schedAction, 'schedule', {
          schedule: { action: 'block', weekdays: schedWeekdays, timeFrom: schedTime, timeTo: schedTime }
        })
      } else {
        await addPowerRule(schedAction, 'monthly_date', {
          monthly_date: { day: Number(schedMonthDay), timeFrom: schedTime, timeTo: schedTime }
        })
      }
      setSchedTime('')
      setSchedWeekdays([0,1,2,3,4,5,6])
      setSchedMonthDay('')
      setShowForm(false)
    } finally {
      setSchedSaving(false)
    }
  }

  // ── Power mode ──────────────────────────────────────────────────────────────
  if (mode === 'power') {
    return (
      <div className="power-panel animate-in">
        <div className="power-timeline-card">

          {/* Top: instant actions + next event */}
          <div className="power-top">
            <div className="power-act-grid">
              {Object.entries(ACTION_META).map(([key, meta]) => (
                <button
                  key={key}
                  className={`power-act-btn power-act-${meta.color} ${successAction === key ? 'success' : ''}`}
                  onClick={() => handleCommand(key)}
                  disabled={!!sendingAction}
                  type="button"
                >
                  {sendingAction === key
                    ? <span className="power-spinner" />
                    : <Icon name={meta.icon} size={18} />
                  }
                  <span>{successAction === key ? 'Отправлено' : meta.label}</span>
                </button>
              ))}
            </div>

            <div className="power-next-widget">
              {nextEvent ? (
                <>
                  <div className="power-next-label">Следующее действие</div>
                  <div className="power-next-time">
                    {nextEvent.time.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
                    <span className="power-next-day">
                      {nextEvent.time.toDateString() === new Date(nowMs).toDateString() ? ' сегодня' : ' завтра'}
                    </span>
                  </div>
                  <div className="power-next-badges">
                    <span className={`power-next-badge power-next-badge--${ACTION_META[nextEvent.rule.action]?.color}`}>
                      <Icon name={ACTION_META[nextEvent.rule.action]?.icon} size={12} />
                      {ACTION_META[nextEvent.rule.action]?.label}
                    </span>
                    <span className="power-next-badge power-next-badge--neutral">
                      {formatCountdown(nextEvent.time - nowMs)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="power-next-empty">
                  <Icon name="clockOff" size={28} />
                  <span>Расписание не задано</span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="power-tl">
            <div className="power-tl-head">
              <span className="power-tl-title">Расписание питания</span>
              <button
                className={`power-tl-add-btn ${showForm ? 'active' : ''}`}
                onClick={() => setShowForm(v => !v)}
                type="button"
              >
                <Icon name={showForm ? 'x' : 'plus'} size={13} />
                {showForm ? 'Отмена' : 'Добавить'}
              </button>
            </div>

            {/* Add form */}
            {showForm && (
              <div className="power-add-form">
                <div className="power-add-field">
                  <div className="power-add-label">Действие</div>
                  <div className="power-add-pills">
                    {Object.entries(ACTION_META).map(([key, meta]) => (
                      <button
                        key={key}
                        type="button"
                        className={`power-add-pill ${schedAction === key ? 'active' : ''}`}
                        onClick={() => setSchedAction(key)}
                      >
                        <Icon name={meta.icon} size={13} />
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="power-add-field">
                  <div className="power-add-label">Повтор</div>
                  <div className="power-add-pills">
                    {[['daily','Ежедневно'],['weekly','По дням'],['monthly','Ежемесячно']].map(([val, lbl]) => (
                      <button key={val} type="button" className={`power-add-pill ${schedMode === val ? 'active' : ''}`} onClick={() => setSchedMode(val)}>{lbl}</button>
                    ))}
                  </div>
                </div>
                {schedMode === 'weekly' && (
                  <div className="power-add-field">
                    <div className="power-add-label">Дни недели</div>
                    <div className="power-add-days">
                      {DAYS.map((d, i) => (
                        <button key={i} type="button" className={`power-add-day ${schedWeekdays.includes(i) ? 'active' : ''}`} onClick={() => toggleSchedDay(i)}>{d}</button>
                      ))}
                    </div>
                  </div>
                )}
                {schedMode === 'monthly' && (
                  <div className="power-add-field">
                    <div className="power-add-label">Число месяца</div>
                    <input type="number" className="input" min="1" max="31" placeholder="Например: 1" value={schedMonthDay} onChange={e => setSchedMonthDay(e.target.value)} style={{ width: 120 }} />
                  </div>
                )}
                <div className="power-add-row">
                  <div className="power-add-field" style={{ flex: 0 }}>
                    <div className="power-add-label">Время</div>
                    <TimeInput value={schedTime} onChange={setSchedTime} />
                  </div>
                  <button className="btn btn-primary power-add-save" onClick={handleAddSchedule} disabled={schedSaving} type="button">
                    {schedSaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </div>
            )}

            {/* Timeline list */}
            {powerScheduleRules.length > 0 ? (
              <div className="power-tl-list">
                {powerScheduleRules
                  .slice()
                  .sort((a, b) => (formatRuleTime(a) > formatRuleTime(b) ? 1 : -1))
                  .map(r => (
                    <div key={r.id} className="power-tl-item">
                      <div className={`power-tl-dot power-tl-dot--${ACTION_META[r.action]?.color}`} />
                      <div className="power-tl-time">{formatRuleTime(r)}</div>
                      <div className="power-tl-info">
                        <div className="power-tl-action">{ACTION_META[r.action]?.label || r.action}</div>
                        <div className="power-tl-days">{formatRuleDays(r)}</div>
                      </div>
                      <button className="power-tl-del" onClick={() => setDeleteConfirmId(r.id)} type="button" title="Удалить">
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ))
                }
              </div>
            ) : !showForm && (
              <div className="power-tl-empty-list">Нет запланированных действий</div>
            )}
          </div>
        </div>

        <ConfirmModal
          isOpen={!!deleteConfirmId}
          title="Удаление расписания"
          message="Удалить это правило расписания питания?"
          confirmText="Удалить"
          confirmDanger={true}
          onConfirm={() => { removeRule(deleteConfirmId); setDeleteConfirmId(null) }}
          onCancel={() => setDeleteConfirmId(null)}
        />
        <ConfirmModal
          isOpen={!!offlineConfirmAction}
          title="Устройство оффлайн"
          message="Агент сейчас оффлайн. Команда будет выполнена, когда ПК снова появится в сети. Продолжить?"
          confirmText="Продолжить"
          onConfirm={handleConfirmOffline}
          onCancel={() => setOfflineConfirmAction(null)}
        />
      </div>
    )
  }

  // ── Lock screen mode ────────────────────────────────────────────────────────
  return (
    <div className="power-panel animate-in">
      <div className="power-card">
        <h2 className="power-card-title">Блокировка экрана</h2>
        <p className="power-card-desc">Моментально заблокировать экран компьютера полноэкранной заставкой.</p>

        <div className="lock-settings">
          <div className="lock-settings-col">
            <div className="input-group">
              <label>Сообщение на экране блокировки</label>
              <input type="text" className="input" value={lockMessage} onChange={e => setLockMessage(e.target.value)} placeholder="Введите текст для заставки..." />
            </div>
            <div className="input-group">
              <label>ПИН-код для разблокировки (опционально)</label>
              <input type="text" className="input" value={lockPin} onChange={e => setLockPin(e.target.value)} placeholder="Например: 1234" />
            </div>
            <div className="lock-options">
              <label className="checkbox-label">
                <input type="checkbox" checked={playSound} onChange={e => setPlaySound(e.target.checked)} />
                <span>Звуковой сигнал (сирена)</span>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={readMessage} onChange={e => setReadMessage(e.target.checked)} />
                <span>Озвучить текст заставки (TTS)</span>
              </label>
              {readMessage && (
                <label className="checkbox-label indent">
                  <input type="checkbox" checked={readMessageRepeat} onChange={e => setReadMessageRepeat(e.target.checked)} />
                  <span>Повторять непрерывно</span>
                </label>
              )}
            </div>
          </div>
          <div className="lock-settings-col">
            <div className="input-group">
              <label>Цвет фона</label>
              <div className="color-palette">
                {COLORS.map(c => (
                  <button key={c.value} className={`color-btn ${lockColor === c.value ? 'active' : ''}`} style={{ backgroundColor: c.value }} onClick={() => setLockColor(c.value)} title={c.label} />
                ))}
              </div>
            </div>
          </div>
        </div>
        {selectedDevice?.isLocked ? (
          <button className={`btn btn-secondary lock-btn-large ${successAction === 'unlock' ? 'success' : ''}`} onClick={() => handleCommand('unlock')} disabled={sendingAction}>
            {sendingAction === 'unlock' ? <span className="power-spinner btn-spinner" /> : successAction === 'unlock' ? '✅ Отправлено!' : '🔓 Разблокировать сейчас'}
          </button>
        ) : (
          <button className={`btn btn-primary lock-btn-large ${successAction === 'lock' ? 'success' : ''}`} onClick={() => handleCommand('lock')} disabled={sendingAction}>
            {sendingAction === 'lock' ? <span className="power-spinner btn-spinner" /> : successAction === 'lock' ? '✅ Отправлено!' : '🔒 Заблокировать сейчас'}
          </button>
        )}
      </div>
      <ConfirmModal
        isOpen={!!offlineConfirmAction}
        title="Устройство оффлайн"
        message="Агент сейчас оффлайн. Команда будет выполнена, когда ПК снова появится в сети. Продолжить?"
        confirmText="Продолжить"
        onConfirm={handleConfirmOffline}
        onCancel={() => setOfflineConfirmAction(null)}
      />
    </div>
  )
}
