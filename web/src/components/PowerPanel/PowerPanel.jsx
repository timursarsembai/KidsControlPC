import React, { useState, useEffect } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './PowerPanel.css'

const COLORS = [
  { label: 'Черный', value: '#000000' },
  { label: 'Темно-серый', value: '#1C1C1C' },
  { label: 'Темно-синий', value: '#0A192F' },
  { label: 'Темно-красный', value: '#2D0A0A' },
  { label: 'Фиолетовый', value: '#1A0B2E' },
  { label: 'Темно-зеленый', value: '#092113' }
]

export default function PowerPanel() {
  const { sendDeviceCommand, updateDeviceSettings, selectedDeviceId, devices } = useRulesStore()
  
  const selectedDevice = devices.find(d => d.id === selectedDeviceId)
  
  const [lockMessage, setLockMessage] = useState('Время вышло! Компьютер заблокирован.')
  const [lockColor, setLockColor] = useState('#000000')
  const [lockPin, setLockPin] = useState('')

  useEffect(() => {
    if (selectedDevice) {
      if (selectedDevice.lockMessage) setLockMessage(selectedDevice.lockMessage)
      if (selectedDevice.lockColor) setLockColor(selectedDevice.lockColor)
      if (selectedDevice.lockPin) setLockPin(selectedDevice.lockPin)
    }
  }, [selectedDevice])

  const isOnline = selectedDevice?.status !== 'offline' && selectedDevice?.lastSeen && 
    (Date.now() - selectedDevice.lastSeen.toDate().getTime()) < 2 * 60 * 1000

  const handleCommand = async (action) => {
    if (!isOnline) {
      if (!window.confirm('Агент сейчас оффлайн. Команда будет выполнена, когда ПК снова появится в сети. Продолжить?')) {
        return
      }
    }
    
    try {
      if (action === 'lock') {
        await updateDeviceSettings({
          lockMessage,
          lockColor,
          lockPin
        })
      }

      const payload = { action }
      if (action === 'lock') {
        payload.message = lockMessage
        payload.color = lockColor
        payload.pin = lockPin
      }
      
      await sendDeviceCommand(payload)
      
      // We could show a toast here, but for now standard alert
      // alert('Команда отправлена успешно!')
    } catch (e) {
      alert('Ошибка при отправке команды: ' + e.message)
    }
  }

  return (
    <div className="power-panel animate-in">
      <div className="power-card">
        <h2 className="power-card-title">Мгновенные действия</h2>
        <p className="power-card-desc">Эти команды будут отправлены на устройство немедленно.</p>
        
        <div className="power-actions-grid">
          <button className="power-action-btn shutdown" onClick={() => handleCommand('shutdown')}>
            <span className="power-action-icon">🔴</span>
            <span className="power-action-label">Выключить</span>
          </button>
          <button className="power-action-btn restart" onClick={() => handleCommand('restart')}>
            <span className="power-action-icon">🔄</span>
            <span className="power-action-label">Перезагрузить</span>
          </button>
          <button className="power-action-btn sleep" onClick={() => handleCommand('sleep')}>
            <span className="power-action-icon">🌙</span>
            <span className="power-action-label">Спящий режим</span>
          </button>
          <button className="power-action-btn hibernate" onClick={() => handleCommand('hibernate')}>
            <span className="power-action-icon">❄️</span>
            <span className="power-action-label">Гибернация</span>
          </button>
        </div>
      </div>

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
        <button className="btn btn-primary lock-btn-large" onClick={() => handleCommand('lock')}>
          🔒 Заблокировать сейчас
        </button>
      </div>
    </div>
  )
}
