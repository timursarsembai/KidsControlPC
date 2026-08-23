import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPairingCode, createRepairPairingCode } from '@kidscontrol/shared/data/pairing'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

function DeviceCard({ device, ownerUid, onRemove, onRename, onForceUpdate, deleting }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(device.alias || device.hostname || device.id)
  const [forcing, setForcing] = useState(false)
  const [repairCode, setRepairCode] = useState(null)
  const [repairing, setRepairing] = useState(false)

  const lastSeen = device?.lastSeen?.toDate?.()
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])
  const isOnline = device?.status !== 'offline' && lastSeen && (now - lastSeen.getTime()) < 2 * 60 * 1000

  const saveRename = () => {
    if (name.trim()) onRename(name.trim())
    setEditing(false)
  }

  const generateRepairCode = async () => {
    setRepairing(true)
    try {
      const result = await createRepairPairingCode(ownerUid, device.id)
      setRepairCode(result.code)
    } catch (err) {
      console.error('Error generating repair code:', err)
    } finally {
      setRepairing(false)
    }
  }

  return (
    <div className="device-card">
      <div className="device-card-row">
      <div className="device-status-dot">
        <span className={`status-dot ${isOnline ? 'active' : 'inactive'}`} />
      </div>
      <div className="device-info">
        {editing ? (
          <div className="device-rename">
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveRename()}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={saveRename}>✓</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>✕</button>
          </div>
        ) : (
          <div className="device-name" onDoubleClick={() => setEditing(true)}>
            {device.alias || device.hostname || 'Неизвестное устройство'}
            <span className="device-edit-hint">двойной клик чтобы переименовать</span>
          </div>
        )}
        <div className="device-meta">
          <span className={`device-online ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● Онлайн' : '● Оффлайн'}
          </span>
          {device.hostname && <span className="device-hostname">{device.hostname}</span>}
          {device.agentVersion && <span className="device-hostname">v{device.agentVersion}</span>}
          {lastSeen && (
            <span className="device-lastseen">
              Последний раз: {lastSeen.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>
      </div>
      <div className="device-actions-row">
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            setForcing(true)
            await onForceUpdate()
            setTimeout(() => setForcing(false), 2000)
          }}
          disabled={forcing || !isOnline}
          title="Принудительное обновление агента"
          style={{ marginRight: 8, fontSize: '0.8rem', padding: '4px 8px' }}
        >
          {forcing ? 'Отправлено...' : '🔄 Обновить агент'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={generateRepairCode}
          disabled={repairing}
          title="Получить код для переустановки агента на этом же устройстве — правила и настройки сохранятся"
          style={{ marginRight: 8, fontSize: '0.8rem', padding: '4px 8px' }}
        >
          {repairing ? <span className="btn-spinner-sm" /> : '🔁 Код для переустановки'}
        </button>
        <button
          className="btn btn-ghost btn-icon btn-sm device-remove"
          onClick={onRemove}
          disabled={deleting}
          title="Отвязать устройство"
        >
          {deleting
            ? <span className="btn-spinner-sm" />
            : <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 11L11 2M2 2l9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
          }
        </button>
      </div>
      </div>
      {repairCode && (
        <div className="code-display" style={{ marginTop: 12 }}>
          <div className="code-label">Код для переустановки (действителен 15 минут)</div>
          <div className="code-value">
            {repairCode.split('').map((c, i) => (
              <span key={i} className="code-char">{c}</span>
            ))}
          </div>
          <div className="code-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setRepairCode(null)}>Скрыть</button>
            <button className="btn btn-ghost btn-sm" onClick={generateRepairCode}>🔄 Новый код</button>
          </div>
          <div className="code-steps">
            <div className="code-step">
              <span className="step-num">1</span>
              <span>Установите <strong>KidsControlPC Agent</strong> на этот ПК (переустановка или новый ноутбук вместо старого)</span>
            </div>
            <div className="code-step">
              <span className="step-num">2</span>
              <span>При запуске агент спросит код привязки — введите код выше</span>
            </div>
            <div className="code-step">
              <span className="step-num">3</span>
              <span>Правила и настройки этого устройства сохранятся, программы пересканируются заново</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DevicesSection({ uid: ownerUid }) {
  const { t } = useTranslation()
  const { devices, renameDevice, deleteDevice } = useRulesStore()
  const [code, setCode] = useState('')
  const [generating, setGenerating] = useState(false)
  const [deleteId, setDeleteId] = useState(null)

  const generateCode = async () => {
    setGenerating(true)
    try {
      const result = await createPairingCode()
      setCode(result.code)
    } catch (err) {
      console.error('Error generating pairing code:', err)
    } finally {
      setGenerating(false)
    }
  }

  const removeDevice = async (deviceId) => {
    setDeleteId(deviceId)
    try {
      await deleteDevice(deviceId)
    } catch (err) {
      console.error('Error deleting device:', err)
    } finally {
      setDeleteId(null)
    }
  }

  const forceUpdateDevice = async () => {
    try {
      await useRulesStore.getState().sendDeviceCommand({ action: 'force_update' })
    } catch (err) {
      console.error('Error forcing update:', err)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">🖥️</div>
        <div>
          <h2 className="settings-section-title">{t('settings.devices.title', 'ПК ребёнка')}</h2>
          <p className="settings-section-desc">
            {t('settings.devices.desc', 'Привяжите компьютер ребёнка — агент будет получать правила блокировки из облака')}
          </p>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="devices-empty">
          <span className="devices-empty-icon">📡</span>
          <span>{t('settings.devices.empty', 'Нет привязанных устройств')}</span>
        </div>
      ) : (
        <div className="devices-list">
          {devices.map(device => (
            <DeviceCard
              key={device.id}
              device={device}
              ownerUid={ownerUid}
              onRemove={() => removeDevice(device.id)}
              onRename={(name) => renameDevice(device.id, name)}
              onForceUpdate={() => forceUpdateDevice(device.id)}
              deleting={deleteId === device.id}
            />
          ))}
        </div>
      )}

      <div className="pairing-card">
        <div className="pairing-header">
          <div className="pairing-title">{t('settings.devices.add_new', 'Добавить новое устройство')}</div>
          <div className="pairing-hint">
            {t('settings.devices.add_hint', 'Установите агент на ПК ребёнка и введите код при первом запуске')}
          </div>
        </div>
        <div className="pairing-body" style={{ marginTop: '1rem' }}>
          {code ? (
            <div className="code-display">
              <div className="code-label">{t('settings.devices.code_active', 'Код привязки (действителен 15 минут)')}</div>
              <div className="code-value">
                {code.split('').map((c, i) => (
                  <span key={i} className="code-char">{c}</span>
                ))}
              </div>
              <div className="code-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setCode('')}>Отмена</button>
                <button className="btn btn-ghost btn-sm" onClick={generateCode}>🔄 Новый код</button>
              </div>
              <div className="code-steps">
                <div className="code-step">
                  <span className="step-num">1</span>
                  <span>Установите <strong>KidsControlPC Agent</strong> на ПК ребёнка</span>
                </div>
                <div className="code-step">
                  <span className="step-num">2</span>
                  <span>При запуске агент спросит код привязки — введите код выше</span>
                </div>
                <div className="code-step">
                  <span className="step-num">3</span>
                  <span>Устройство появится в этом списке автоматически</span>
                </div>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-primary pairing-btn"
              onClick={generateCode}
              disabled={generating}
            >
              {generating ? <><span className="btn-spinner-sm" /> ...</> : t('settings.devices.code_gen', '+ Сгенерировать код привязки')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
