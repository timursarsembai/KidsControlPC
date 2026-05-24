import React, { useState } from 'react'
import { auth } from '../../firebase/config'
import { db } from '../../firebase/config'
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth'
import {
  collection, doc, setDoc, addDoc, serverTimestamp
} from 'firebase/firestore'
import { useRulesStore } from '../../stores/useRulesStore'
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

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">🖥️</div>
        <div>
          <h2 className="settings-section-title">ПК ребёнка</h2>
          <p className="settings-section-desc">
            Привяжите компьютер ребёнка — агент будет получать правила блокировки из облака
          </p>
        </div>
      </div>

      {/* Connected devices */}
      {devices.length === 0 ? (
        <div className="devices-empty">
          <span className="devices-empty-icon">📡</span>
          <span>Нет привязанных устройств</span>
        </div>
      ) : (
        <div className="devices-list">
          {devices.map(device => (
            <DeviceCard
              key={device.id}
              device={device}
              onRemove={() => removeDevice(device.id)}
              onRename={(name) => renameDevice(device.id, name)}
              deleting={deleteId === device.id}
            />
          ))}
        </div>
      )}

      {/* Pairing code generator */}
      <div className="pairing-card">
        <div className="pairing-header">
          <div className="pairing-title">Добавить новое устройство</div>
          <div className="pairing-hint">
            Установите агент на ПК ребёнка и введите код при первом запуске
          </div>
        </div>

        {code ? (
          <div className="code-display">
            <div className="code-label">Код привязки (действителен 15 минут)</div>
            <div className="code-value">
              {code.split('').map((c, i) => (
                <span key={i} className="code-char">{c}</span>
              ))}
            </div>
            <div className="code-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setCode('')}>
                Отмена
              </button>
              <button className="btn btn-ghost btn-sm" onClick={generateCode}>
                🔄 Новый код
              </button>
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
            {generating ? <><span className="btn-spinner-sm" /> Генерирую...</> : '+ Сгенерировать код привязки'}
          </button>
        )}
      </div>
    </section>
  )
}

function DeviceCard({ device, onRemove, onRename, deleting }) {
  const [editing, setEditing] = useState(false)
  const [name, setName]       = useState(device.alias || device.hostname || device.id)

  const lastSeen = device?.lastSeen?.toDate?.()
  const isOnline = device?.status !== 'offline' && lastSeen && (Date.now() - lastSeen.getTime()) < 2 * 60 * 1000

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
          {lastSeen && (
            <span className="device-lastseen">
              Последний раз: {lastSeen.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>
      </div>
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
  )
}

// ─── Account section ──────────────────────────────────────────────────────────
function AccountSection({ user }) {
  const [currentPwd, setCurrentPwd]   = useState('')
  const [newPwd, setNewPwd]           = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [pwdLoading, setPwdLoading]   = useState(false)
  const [pwdMsg, setPwdMsg]           = useState(null)  // { type: 'success'|'error', text }

  const changePassword = async (e) => {
    e.preventDefault()
    if (newPwd !== confirmPwd) {
      setPwdMsg({ type: 'error', text: 'Новые пароли не совпадают' })
      return
    }
    if (newPwd.length < 6) {
      setPwdMsg({ type: 'error', text: 'Пароль должен быть не менее 6 символов' })
      return
    }
    setPwdLoading(true)
    setPwdMsg(null)
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPwd)
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, newPwd)
      setPwdMsg({ type: 'success', text: 'Пароль успешно изменён' })
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch (err) {
      const msgs = {
        'auth/wrong-password': 'Неверный текущий пароль',
        'auth/invalid-credential': 'Неверный текущий пароль',
        'auth/too-many-requests': 'Слишком много попыток, подождите немного',
      }
      setPwdMsg({ type: 'error', text: msgs[err.code] || err.message })
    } finally {
      setPwdLoading(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">👤</div>
        <div>
          <h2 className="settings-section-title">Аккаунт</h2>
          <p className="settings-section-desc">Управление профилем и паролем</p>
        </div>
      </div>

      {/* Account info */}
      <div className="account-info-card">
        <div className="account-avatar">{user.email[0].toUpperCase()}</div>
        <div>
          <div className="account-email">{user.email}</div>
          <div className="account-plan">
            <span className="plan-badge">Free</span>
            <span className="account-since">
              Аккаунт создан: {user.metadata?.creationTime
                ? new Date(user.metadata.creationTime).toLocaleDateString('ru-RU')
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="settings-subsection">
        <h3 className="subsection-title">Сменить пароль</h3>
        <form className="settings-form" onSubmit={changePassword}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Текущий пароль</label>
              <input type="password" className="input" placeholder="Текущий пароль"
                value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} required />
            </div>
          </div>
          <div className="form-row two-cols">
            <div className="form-group">
              <label className="form-label">Новый пароль</label>
              <input type="password" className="input" placeholder="Минимум 6 символов"
                value={newPwd} onChange={e => setNewPwd(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Повтор пароля</label>
              <input type="password" className="input" placeholder="Повторите новый пароль"
                value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} required />
            </div>
          </div>

          {pwdMsg && (
            <div className={`settings-msg ${pwdMsg.type}`}>
              {pwdMsg.type === 'success' ? '✓ ' : '✕ '}{pwdMsg.text}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={pwdLoading}>
            {pwdLoading ? <><span className="btn-spinner-sm" /> Сохранение...</> : 'Сменить пароль'}
          </button>
        </form>
      </div>
    </section>
  )
}

// ─── About / Info section ─────────────────────────────────────────────────────
function AboutSection() {
  const { devices } = useRulesStore()
  const hasDevices = devices.length > 0
  const anyOnline = devices.some(d => {
    const lastSeen = d.lastSeen?.toDate?.()
    return lastSeen && (Date.now() - lastSeen.getTime()) < 3 * 60 * 1000
  })

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">ℹ️</div>
        <div>
          <h2 className="settings-section-title">О приложении</h2>
          <p className="settings-section-desc">Версия и информация о системе</p>
        </div>
      </div>

      <div className="about-grid">
        <div className="about-item">
          <span className="about-label">Приложение</span>
          <span className="about-value">KidsControlPC (Родительское)</span>
        </div>
        <div className="about-item">
          <span className="about-label">Версия</span>
          <span className="about-value">1.0.0-mvp</span>
        </div>
        <div className="about-item">
          <span className="about-label">Платформа</span>
          <span className="about-value">Windows 10 / 11</span>
        </div>
        <div className="about-item">
          <span className="about-label">Синхронизация</span>
          <span className="about-value">Firebase Firestore (Realtime)</span>
        </div>
        <div className="about-item">
          <span className="about-label">Статус агента</span>
          <span className="about-value about-status">
            {hasDevices ? (
              anyOnline ? (
                <><span className="status-dot active" /> Подключен ({devices.length} ПК, Онлайн)</>
              ) : (
                <><span className="status-dot inactive" /> Подключен ({devices.length} ПК, Оффлайн)</>
              )
            ) : (
              <><span className="status-dot inactive" /> Не установлен на детском ПК</>
            )}
          </span>
        </div>
      </div>

      <div className="about-roadmap">
        <div className="roadmap-title">Дорожная карта</div>
        <div className="roadmap-item done">✅ Родительский UI с устройствами в виде вкладок</div>
        <div className="roadmap-item done">✅ Firebase Auth + Firestore синхронизация устройств</div>
        <div className="roadmap-item done">✅ Синхронизация списка установленных программ с детского ПК</div>
        <div className="roadmap-item done">✅ Экран настроек (устройства, аккаунт)</div>
        <div className="roadmap-item done">✅ Детский фоновый агент (подключение, heartbeat, реестр)</div>
        <div className="roadmap-item done">✅ Реальная блокировка сайтов (hosts) и программ (процессы)</div>
        <div className="roadmap-item done">✅ Запуск в фоне как служба Windows Service</div>
        <div className="roadmap-item future">⏳ Уведомления-тревоги при попытке обхода защиты</div>
        <div className="roadmap-item future">⏳ Экран активности и статистики</div>
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
  const { user } = useRulesStore()
  const [activeTab, setActiveTab] = useState('devices')

  if (!user) return null

  return (
    <div className="settings-panel animate-in">
      <div className="settings-sidebar">
        <div className="settings-sidebar-title">Настройки</div>
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
