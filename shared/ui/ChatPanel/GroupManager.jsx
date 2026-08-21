import { useState } from 'react'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

function isDeviceOnline(device) {
  const lastSeen = device?.lastSeen?.toDate?.()
  return device?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000
}

export default function GroupManager({ onClose, onCreated }) {
  const { devices, createGroupChat, createDirectChat } = useRulesStore()
  const [mode, setMode] = useState('group') // 'group' | 'direct'
  const [name, setName] = useState('')
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleDevice = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id])
  }

  const handleCreate = async () => {
    if (mode === 'group' && !name.trim()) { setError('Введите название группы'); return }
    if (selected.length === 0) { setError('Выберите хотя бы одно устройство'); return }
    if (mode === 'direct' && selected.length > 1) { setError('Личный чат — только одно устройство'); return }

    setSaving(true)
    setError('')
    try {
      let chatId
      if (mode === 'group') {
        chatId = await createGroupChat(name.trim(), selected)
      } else {
        const device = devices.find(d => d.id === selected[0])
        chatId = await createDirectChat(selected[0], device?.alias || device?.hostname || 'Устройство')
      }
      onCreated(chatId)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="group-manager-overlay" onClick={onClose}>
      <div className="group-manager" onClick={e => e.stopPropagation()}>
        <div className="group-manager-header">
          <h3>Новый чат</h3>
          <button className="group-manager-close" onClick={onClose}>×</button>
        </div>

        <div className="group-manager-tabs">
          <button
            className={`group-tab ${mode === 'group' ? 'active' : ''}`}
            onClick={() => { setMode('group'); setSelected([]) }}
          >
            👥 Группа
          </button>
          <button
            className={`group-tab ${mode === 'direct' ? 'active' : ''}`}
            onClick={() => { setMode('direct'); setSelected([]) }}
          >
            💬 Личный чат
          </button>
        </div>

        {mode === 'group' && (
          <div className="group-manager-field">
            <label className="group-field-label">Название группы</label>
            <input
              className="input"
              placeholder="Например: Все дети"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className="group-manager-field">
          <label className="group-field-label">
            {mode === 'group' ? 'Добавить устройства' : 'Выбрать устройство'}
          </label>
          {devices.length === 0 && (
            <div className="group-no-devices">Нет подключённых устройств</div>
          )}
          <div className="group-device-list">
            {devices.map(device => (
              <label key={device.id} className={`group-device-item ${selected.includes(device.id) ? 'selected' : ''}`}>
                <input
                  type={mode === 'direct' ? 'radio' : 'checkbox'}
                  name="device"
                  checked={selected.includes(device.id)}
                  onChange={() => {
                    if (mode === 'direct') setSelected([device.id])
                    else toggleDevice(device.id)
                  }}
                />
                <span className="group-device-icon">🖥️</span>
                <span className="group-device-name">{device.alias || device.hostname || device.id}</span>
                <span className={`group-device-status ${isDeviceOnline(device) ? 'online' : 'offline'}`}>
                  {isDeviceOnline(device) ? 'онлайн' : 'офлайн'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <div className="group-manager-error">{error}</div>}

        <div className="group-manager-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving || selected.length === 0}>
            {saving ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
