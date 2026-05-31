import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '@kidscontrol/shared/firebase/config'
import { db } from '@kidscontrol/shared/firebase/config'
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth'
import {
  collection, doc, setDoc, addDoc, serverTimestamp
} from 'firebase/firestore'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import './SettingsPanel.css'

// ─── Generate a 6-character pairing code ─────────────────────────────────────
function generatePairingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function DevicesSection({ uid }) {
  const { t } = useTranslation()
  const { devices, renameDevice, deleteDevice } = useRulesStore()
  const [code, setCode]           = useState('')
  const [generating, setGenerating] = useState(false)
  const [deleteId, setDeleteId]   = useState(null)

  const generateCode = async () => {
    setGenerating(true)
    try {
      const newCode = generatePairingCode()
      // Save pairing code to Firestore with 15-min expiry
      await setDoc(doc(db, 'pairingCodes', newCode), {
        parentUid: uid,
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        used: false
      })
      setCode(newCode)
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

  const forceUpdateDevice = async (deviceId) => {
    try {
      await useRulesStore.getState().sendDeviceCommand(deviceId, 'force_update')
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
              onRemove={() => removeDevice(device.id)}
              onRename={(name) => renameDevice(device.id, name)}
              onForceUpdate={() => forceUpdateDevice(device.id)}
              deleting={deleteId === device.id}
            />
          ))}
        </div>
      )}

      {/* Pairing code generator */}
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

function DeviceCard({ device, onRemove, onRename, onForceUpdate, deleting }) {
  const [editing, setEditing] = useState(false)
  const [name, setName]       = useState(device.alias || device.hostname || device.id)
  const [forcing, setForcing] = useState(false)

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

  return (
    <div className="device-card">
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
  )
}

// ─── Account section ──────────────────────────────────────────────────────────
function AccountSection({ user }) {
  const { t, i18n } = useTranslation()
  const { logout } = useRulesStore()

  const handleLanguageChange = (e) => {
    const lang = e.target.value
    i18n.changeLanguage(lang)
    localStorage.setItem('appLanguage', lang)
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">👤</div>
        <div>
          <h2 className="settings-section-title">{t('settings.account.title', 'Аккаунт')}</h2>
          <p className="settings-section-desc">{t('settings.account.desc', 'Управление профилем и настройками')}</p>
        </div>
      </div>

      <div className="account-card">
        <div className="account-info">
          <div className="account-avatar">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="account-details">
            <span className="account-email">{user?.email}</span>
            <span className="account-id">ID: {user?.uid.slice(0,8)}...</span>
          </div>
        </div>
        
        <button 
          className="btn btn-danger" 
          onClick={logout}
          style={{ width: '100%', marginTop: 20 }}
        >
          {t('settings.account.logout', 'Выйти из аккаунта')}
        </button>
      </div>
    </section>
  )
}

// ─── About / Info section ─────────────────────────────────────────────────────
function AboutSection() {
  const { t, i18n } = useTranslation()
  const { devices } = useRulesStore()
  const hasDevices = devices.length > 0
  const anyOnline = devices.some(d => {
    const lastSeen = d.lastSeen?.toDate?.()
    return lastSeen && (Date.now() - lastSeen.getTime()) < 3 * 60 * 1000
  })

  const handleLanguageChange = (e) => {
    const lang = e.target.value
    i18n.changeLanguage(lang)
    localStorage.setItem('appLanguage', lang)
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">ℹ️</div>
        <div>
          <h2 className="settings-section-title">{t('settings.about.title', 'О приложении')}</h2>
          <p className="settings-section-desc">{t('settings.about.desc', 'Настройки и информация')}</p>
        </div>
      </div>

      <div className="about-grid">
        <div className="about-item">
          <span className="about-label">{t('settings.language', 'Язык (Language)')}</span>
          <select 
            className="input" 
            style={{ width: '100%', marginTop: 5 }} 
            value={i18n.language} 
            onChange={handleLanguageChange}
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>
        
        <div className="about-item">
          <span className="about-label">{t('settings.about.app_label', 'Приложение')}</span>
          <span className="about-value">KidsControlPC</span>
        </div>
        <div className="about-item">
          <span className="about-label">{t('settings.about.status_label', 'Статус агента')}</span>
          <span className="about-value about-status">
            {hasDevices ? (
              anyOnline ? (
                <><span className="status-dot active" /> {t('settings.about.status_online', 'Подключен (Онлайн)')}</>
              ) : (
                <><span className="status-dot inactive" /> {t('settings.about.status_offline', 'Подключен (Оффлайн)')}</>
              )
            ) : (
              <><span className="status-dot inactive" /> {t('settings.about.status_not_installed', 'Не установлен')}</>
            )}
          </span>
        </div>
      </div>
    </section>
  )
}

// ─── Main Settings Panel ──────────────────────────────────────────────────────
const TABS = [
  { id: 'devices', label: 'Устройства', icon: '🖥️' },
  { id: 'account', label: 'Аккаунт',    icon: '👤' },
  { id: 'about',   label: 'О приложении', icon: 'ℹ️' },
]

export default function SettingsPanel() {
  const { t } = useTranslation()
  const { user } = useRulesStore()
  const [activeTab, setActiveTab] = useState('devices')

  if (!user) return null

  return (
    <div className="settings-panel animate-in">
      <div className="settings-sidebar">
        <div className="settings-sidebar-title">{t('settings.title', 'Настройки')}</div>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="settings-nav-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {activeTab === 'devices' && <DevicesSection uid={user.uid} />}
        {activeTab === 'account' && <AccountSection user={user} />}
        {activeTab === 'about'   && <AboutSection />}
      </div>
    </div>
  )
}

