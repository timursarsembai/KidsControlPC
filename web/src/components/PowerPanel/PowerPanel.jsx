import React, { useState, useEffect } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ConfirmModal from '../ConfirmModal'
import TimeInput from '../TimeInput/TimeInput'
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

const ACTION_LABELS = {
  shutdown: { label: 'Выключить', icon: '🔴' },
  restart:  { label: 'Перезагрузить', icon: '🔄' },
  sleep:    { label: 'Спящий режим', icon: '🌙' },
  hibernate:{ label: 'Гибернация', icon: '❄️' },
}

function formatPowerSchedule(r) {
  const actionLabel = ACTION_LABELS[r.action]?.label || r.action
  if (r.mode === 'schedule' && r.schedule) {
    const time = r.schedule.timeFrom || r.schedule.ranges?.[0]?.timeFrom || '?'
    const weekdays = r.schedule.weekdays || r.schedule.groups?.[0]?.weekdays
    if (!weekdays || weekdays.length === 7) return `${actionLabel} — ежедневно в ${time}`
    const daysStr = weekdays.map(d => DAYS[d]).join(', ')
    return `${actionLabel} — ${daysStr} в ${time}`
  }
  if (r.mode === 'monthly_date' && r.monthly_date) {
    return `${actionLabel} — каждый месяц ${r.monthly_date.day}-го числа в ${r.monthly_date.timeFrom}`
  }
  if (r.mode === 'date' && r.date) {
    return `${actionLabel} — разово: ${r.date.date} в ${r.date.timeFrom}`
  }
  return actionLabel
}

// ── Power Schedule Section ────────────────────────────────────────────────────
function PowerScheduleSection() {
  const { rules, addPowerRule, removeRule } = useRulesStore()
  const powerScheduleRules = rules.filter(r => r.type === 'power' && r.mode !== 'permanent')

  const [action, setAction] = useState('shutdown')
  const [schedMode, setSchedMode] = useState('daily') // 'daily' | 'weekly' | 'monthly'
  const [time, setTime] = useState('')
  const [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5, 6])
  const [monthDay, setMonthDay] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const toggleDay = (i) => {
    setWeekdays(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])
  }

  const handleAdd = async () => {
    if (!time) return alert('Укажите время')
    if (schedMode === 'weekly' && weekdays.length === 0) return alert('Выберите хотя бы один день недели')
    if (schedMode === 'monthly' && !monthDay) return alert('Укажите число месяца')

    setSaving(true)
    try {
      if (schedMode === 'daily') {
        await addPowerRule(action, 'schedule', {
          schedule: { action: 'block', weekdays: [0,1,2,3,4,5,6], timeFrom: time, timeTo: time }
        })
      } else if (schedMode === 'weekly') {
        await addPowerRule(action, 'schedule', {
          schedule: { action: 'block', weekdays, timeFrom: time, timeTo: time }
        })
      } else {
        await addPowerRule(action, 'monthly_date', {
          monthly_date: { day: Number(monthDay), timeFrom: time, timeTo: time }
        })
      }
      setTime('')
      setWeekdays([0,1,2,3,4,5,6])
      setMonthDay('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="power-card">
      <h2 className="power-card-title">Расписание питания</h2>
      <p className="power-card-desc">Автоматически выключать или переводить ПК в нужный режим по расписанию.</p>

      {/* Form */}
      <div className="power-sched-form">
        {/* Action */}
        <div className="power-sched-field">
          <label className="power-sched-label">Действие</label>
          <div className="power-sched-action-row">
            {Object.entries(ACTION_LABELS).map(([key, { label, icon }]) => (
              <button
                key={key}
                className={`power-sched-action-btn ${action === key ? 'active' : ''}`}
                onClick={() => setAction(key)}
                type="button"
              >
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Schedule type */}
        <div className="power-sched-field">
          <label className="power-sched-label">Повтор</label>
          <div className="power-sched-tabs">
            <button className={`power-sched-tab ${schedMode === 'daily' ? 'active' : ''}`} onClick={() => setSchedMode('daily')} type="button">Ежедневно</button>
            <button className={`power-sched-tab ${schedMode === 'weekly' ? 'active' : ''}`} onClick={() => setSchedMode('weekly')} type="button">По дням</button>
            <button className={`power-sched-tab ${schedMode === 'monthly' ? 'active' : ''}`} onClick={() => setSchedMode('monthly')} type="button">Ежемесячно</button>
          </div>
        </div>

        {/* Days picker (weekly only) */}
        {schedMode === 'weekly' && (
          <div className="power-sched-field">
            <label className="power-sched-label">Дни недели</label>
            <div className="power-sched-days">
              {DAYS.map((d, i) => (
                <button
                  key={i}
                  className={`power-sched-day ${weekdays.includes(i) ? 'active' : ''}`}
                  onClick={() => toggleDay(i)}
                  type="button"
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Month day (monthly only) */}
        {schedMode === 'monthly' && (
          <div className="power-sched-field">
            <label className="power-sched-label">Число месяца</label>
            <input
              type="number"
              className="input"
              min="1" max="31"
              placeholder="Например: 1"
              value={monthDay}
              onChange={e => setMonthDay(e.target.value)}
              style={{ width: 120 }}
            />
          </div>
        )}

        {/* Time */}
        <div className="power-sched-field">
          <label className="power-sched-label">Время</label>
          <TimeInput value={time} onChange={setTime} />
        </div>

        <button
          className="btn btn-primary power-sched-add-btn"
          onClick={handleAdd}
          disabled={saving}
          type="button"
        >
          {saving ? 'Сохранение...' : '+ Добавить расписание'}
        </button>
      </div>

      {/* List */}
      {powerScheduleRules.length > 0 && (
        <div className="power-sched-list">
          {powerScheduleRules.map(r => (
            <div key={r.id} className="power-sched-item">
              <span className="power-sched-item-icon">{ACTION_LABELS[r.action]?.icon || '⚡'}</span>
              <span className="power-sched-item-text">{formatPowerSchedule(r)}</span>
              <button
                className="power-sched-delete"
                onClick={() => setDeleteConfirmId(r.id)}
                title="Удалить"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M3.5 3.5l.5 8h6l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteConfirmId}
        title="Удаление расписания"
        message="Удалить это правило расписания питания?"
        confirmText="Удалить"
        confirmDanger={true}
        onConfirm={() => { removeRule(deleteConfirmId); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PowerPanel({ mode = 'power' }) {
  const { sendDeviceCommand, updateDeviceSettings, selectedDeviceId, devices } = useRulesStore()

  const selectedDevice = devices.find(d => d.id === selectedDeviceId)

  const [lockMessage, setLockMessage] = useState('Время вышло! Компьютер заблокирован.')
  const [lockColor, setLockColor] = useState('#000000')
  const [lockPin, setLockPin] = useState('')
  const [playSound, setPlaySound] = useState(true)
  const [readMessage, setReadMessage] = useState(false)
  const [readMessageRepeat, setReadMessageRepeat] = useState(false)
  const [sendingAction, setSendingAction] = useState(null)
  const [successAction, setSuccessAction] = useState(null)

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

  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])
  const isOnline = selectedDevice?.status !== 'offline' && selectedDevice?.lastSeen &&
    (now - selectedDevice.lastSeen.toDate().getTime()) < 2 * 60 * 1000

  const [offlineConfirmAction, setOfflineConfirmAction] = React.useState(null)

  const handleCommand = async (action) => {
    if (!isOnline) {
      setOfflineConfirmAction(action)
      return
    }
    await executeCommand(action)
  }

  const handleConfirmOffline = async () => {
    const action = offlineConfirmAction
    setOfflineConfirmAction(null)
    if (action) {
      await executeCommand(action)
    }
  }

  const executeCommand = async (action) => {
    setSendingAction(action)
    try {
      if (action === 'lock') {
        await updateDeviceSettings({
          isLocked: true,
          lockMessage,
          lockColor,
          lockPin,
          playSound,
          readMessage,
          readMessageRepeat
        })
      } else if (action === 'unlock') {
        await updateDeviceSettings({
          isLocked: false
        })
      } else if (action === 'update_agent') {
        await updateDeviceSettings({
          forceUpdateRequestedAtMs: Date.now()
        })
      }

      const payload = { action }
      if (action === 'lock') {
        payload.message = lockMessage
        payload.color = lockColor
        payload.pin = lockPin
        payload.playSound = playSound
        payload.readMessage = readMessage
        payload.readMessageRepeat = readMessageRepeat
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

  // ── Power mode ─────────────────────────────────────────────────────────────
  if (mode === 'power') {
    return (
      <div className="power-panel animate-in">
        <div className="power-card">
          <h2 className="power-card-title">Мгновенные действия</h2>
          <p className="power-card-desc">Эти команды будут отправлены на устройство немедленно.</p>

          <div className="power-actions-grid">
            <button className={`power-action-btn shutdown ${successAction === 'shutdown' ? 'success' : ''}`} onClick={() => handleCommand('shutdown')} disabled={sendingAction}>
              {sendingAction === 'shutdown' ? <span className="power-spinner" /> : successAction === 'shutdown' ? <span className="power-action-icon">✅</span> : <span className="power-action-icon">🔴</span>}
              <span className="power-action-label">{successAction === 'shutdown' ? 'Отправлено' : 'Выключить'}</span>
            </button>
            <button className={`power-action-btn restart ${successAction === 'restart' ? 'success' : ''}`} onClick={() => handleCommand('restart')} disabled={sendingAction}>
              {sendingAction === 'restart' ? <span className="power-spinner" /> : successAction === 'restart' ? <span className="power-action-icon">✅</span> : <span className="power-action-icon">🔄</span>}
              <span className="power-action-label">{successAction === 'restart' ? 'Отправлено' : 'Перезагрузить'}</span>
            </button>
            <button className={`power-action-btn sleep ${successAction === 'sleep' ? 'success' : ''}`} onClick={() => handleCommand('sleep')} disabled={sendingAction}>
              {sendingAction === 'sleep' ? <span className="power-spinner" /> : successAction === 'sleep' ? <span className="power-action-icon">✅</span> : <span className="power-action-icon">🌙</span>}
              <span className="power-action-label">{successAction === 'sleep' ? 'Отправлено' : 'Спящий режим'}</span>
            </button>
            <button className={`power-action-btn hibernate ${successAction === 'hibernate' ? 'success' : ''}`} onClick={() => handleCommand('hibernate')} disabled={sendingAction}>
              {sendingAction === 'hibernate' ? <span className="power-spinner" /> : successAction === 'hibernate' ? <span className="power-action-icon">✅</span> : <span className="power-action-icon">❄️</span>}
              <span className="power-action-label">{successAction === 'hibernate' ? 'Отправлено' : 'Гибернация'}</span>
            </button>
            <button className={`power-action-btn update_agent ${successAction === 'update_agent' ? 'success' : ''}`} onClick={() => handleCommand('update_agent')} disabled={sendingAction} style={{ gridColumn: '1 / -1' }}>
              {sendingAction === 'update_agent' ? <span className="power-spinner" /> : successAction === 'update_agent' ? <span className="power-action-icon">✅</span> : <span className="power-action-icon">📦</span>}
              <span className="power-action-label">{successAction === 'update_agent' ? 'Команда отправлена' : 'Принудительно обновить Агента (тихая установка)'}</span>
            </button>
          </div>
        </div>

        <PowerScheduleSection />

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
              <input
                type="text"
                className="input"
                value={lockMessage}
                onChange={e => setLockMessage(e.target.value)}
                placeholder="Введите текст для заставки..."
              />
            </div>

            <div className="input-group">
              <label>ПИН-код для разблокировки (опционально)</label>
              <input
                type="text"
                className="input"
                value={lockPin}
                onChange={e => setLockPin(e.target.value)}
                placeholder="Например: 1234"
              />
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
                  <button
                    key={c.value}
                    className={`color-btn ${lockColor === c.value ? 'active' : ''}`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setLockColor(c.value)}
                    title={c.label}
                  />
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
