import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  authErrorMessage,
  changePassword,
  deleteAccount,
  requiresCurrentPasswordToChange,
  requiresPasswordToDelete,
  signOutUser
} from '@kidscontrol/shared/data/auth'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

export default function AccountSection({ user }) {
  const { t } = useTranslation()
  const { accountRole, userProfile, setChatDisplayName } = useRulesStore()
  const [chatName, setChatName] = useState(userProfile?.chatName || '')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwdMessage, setPwdMessage] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSaveChatName = async () => {
    await setChatDisplayName(chatName.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleChangePassword = async () => {
    setPwdError('')
    setPwdMessage('')
    if (newPassword.length < 8) {
      setPwdError('Новый пароль должен быть не менее 8 символов.')
      return
    }
    setChangingPwd(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      // Said plainly because it is not obvious: everything else signed in with
      // the old password has just been signed out.
      setPwdMessage('Пароль изменён. Остальные устройства придётся войти заново.')
    } catch (err) {
      setPwdError(
        err?.code === 'invalid_credentials'
          ? 'Текущий пароль неверен.'
          : err?.code === 'auth/requires-recent-login'
            ? 'Для смены пароля выйдите и войдите снова, затем повторите.'
            : authErrorMessage(err)
      )
    } finally {
      setChangingPwd(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      await deleteAccount(deletePassword)
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setDeleteError('Для удаления аккаунта выйдите и войдите снова, затем повторите.')
      } else if (err.code === 'invalid_credentials') {
        setDeleteError('Неверный пароль.')
        setDeleting(false)
        return
      } else {
        setDeleteError(authErrorMessage(err))
      }
      setConfirmDelete(false)
    } finally {
      setDeletePassword('')
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
        onClick={() => signOutUser()}
        style={{ width: '100%' }}
        type="button"
      >
        {t('settings.account.logout', 'Выйти из аккаунта')}
      </button>

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <div className="form-label" style={{ marginBottom: 8 }}>Смена пароля</div>
          {requiresCurrentPasswordToChange && (
            <input
              type="password"
              className="input"
              placeholder="Текущий пароль"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              style={{ marginBottom: 8 }}
            />
          )}
          <input
            type="password"
            className="input"
            placeholder="Новый пароль (не менее 8 символов)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
            style={{ marginBottom: 8 }}
          />
          {pwdError && (
            <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{pwdError}</div>
          )}
          {pwdMessage && (
            <div style={{ color: 'var(--success, #20c997)', fontSize: 13, marginBottom: 8 }}>{pwdMessage}</div>
          )}
          <button
            className="btn"
            type="button"
            onClick={handleChangePassword}
            disabled={changingPwd || !newPassword || (requiresCurrentPasswordToChange && !currentPassword)}
            style={{ width: '100%' }}
          >
            {changingPwd ? 'Сохранение...' : 'Изменить пароль'}
          </button>
        </div>

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
          <div>
            {requiresPasswordToDelete && (
              <input
                type="password"
                className="input"
                placeholder="Подтвердите паролем"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                autoComplete="current-password"
                style={{ marginBottom: 8 }}
              />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-danger"
              onClick={handleDeleteAccount}
              disabled={deleting || (requiresPasswordToDelete && !deletePassword)}
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
          </div>
        )}
      </div>
    </section>
  )
}
