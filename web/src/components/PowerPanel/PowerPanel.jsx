import React, { useState, useEffect } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import ConfirmModal from '../ConfirmModal'
import './PowerPanel.css'

const COLORS = [
  { label: 'Черный', value: '#000000' },
  { label: 'Темно-серый', value: '#1C1C1C' },
  { label: 'Темно-синий', value: '#0A192F' },
  { label: 'Темно-красный', value: '#2D0A0A' },
  { label: 'Фиолетовый', value: '#1A0B2E' },
  { label: 'Темно-зеленый', value: '#092113' }
]

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
