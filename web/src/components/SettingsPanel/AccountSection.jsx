import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { signOut, deleteUser } from 'firebase/auth'
import { auth } from '@kidscontrol/shared/firebase/config'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

export default function AccountSection({ user }) {
  const { t } = useTranslation()
  const { accountRole, userProfile, setChatDisplayName } = useRulesStore()
  const [chatName, setChatName] = useState(userProfile?.chatName || '')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleSaveChatName = async () => {
    await setChatDisplayName(chatName.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDeleteAccount = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      await deleteUser(auth.currentUser)
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setDeleteError('Для удаления аккаунта выйдите и войдите снова, затем повторите.')
      } else {
        setDeleteError(`Ошибка: ${err.message}`)
      }
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">👤</div>
        <div>
          <h2 className="settings-section-title">{t('settings.account.title', 'Аккаунт')}</h2>
          <p className="settings-section-desc">{t('settings.account.desc', 'Управление профилем и безопасностью')}</p>
        </div>
      </div>

      <div className="account-info-card">
        <div className="account-avatar">
          {user?.email?.charAt(0).toUpperCase()}
        </div>
        <div className="account-details">
          <span className="account-email">{user?.email}</span>
          <div className="account-plan">
            <span className="plan-badge">{accountRole === 'parent' ? 'Родитель' : 'Владелец'}</span>
            <span className="account-since">ID: {user?.uid.slice(0, 8)}...</span>
          </div>
        </div>
      </div>

      <div className="chat-name-setting" style={{ margin: '20px 0' }}>
        <label className="settings-field-label" style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Имя в чате с детьми
        </label>
        <p className="settings-section-desc" style={{ marginTop: 0, marginBottom: 10 }}>
          Как дети будут видеть вас в мессенджере (например: Папа, Мама, Бабушка)
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="settings-input"
            value={chatName}
            onChange={e => setChatName(e.target.value)}
            placeholder="Папа"
            maxLength={40}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8 }}
          />
          <button className="btn btn-primary" onClick={handleSaveChatName} type="button">
            {saved ? '✓ Сохранено' : 'Сохранить'}
          </button>
        </div>
      </div>

      <button
        className="btn btn-danger"
        onClick={() => signOut(auth)}
        style={{ width: '100%' }}
        type="button"
      >
        {t('settings.account.logout', 'Выйти из аккаунта')}
      </button>

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
        <p className="settings-section-desc" style={{ marginBottom: 12 }}>
          Удаление аккаунта необратимо. Все данные будут потеряны.
        </p>
        {deleteError && (
          <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{deleteError}</div>
        )}
        {!confirmDelete ? (
          <button
            className="btn"
            onClick={() => { setDeleteError(''); setConfirmDelete(true) }}
            style={{ width: '100%', background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)' }}
            type="button"
          >
            Удалить аккаунт
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-danger"
              onClick={handleDeleteAccount}
              disabled={deleting}
              style={{ flex: 1 }}
              type="button"
            >
              {deleting ? 'Удаление...' : 'Да, удалить'}
            </button>
            <button
              className="btn"
              onClick={() => setConfirmDelete(false)}
              style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
              type="button"
            >
              Отмена
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
