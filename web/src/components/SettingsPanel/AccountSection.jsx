import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { signOut } from 'firebase/auth'
import { auth } from '@kidscontrol/shared/firebase/config'
import {
  createParentInvitation,
  subscribeToParentAccess,
  subscribeToParentInvitations
} from '@kidscontrol/shared/firebase/parents'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

function statusLabel(status) {
  if (status === 'accepted') return 'Принято'
  if (status === 'declined') return 'Отклонено'
  if (status === 'active') return 'Активен'
  return 'Ожидает'
}

export default function AccountSection({ user }) {
  const { t } = useTranslation()
  const { activeOwnerUid, accountRole } = useRulesStore()
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitations, setInvitations] = useState([])
  const [parents, setParents] = useState([])
  const [loadingInvite, setLoadingInvite] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const isPrimaryOwner = accountRole === 'owner' && activeOwnerUid === user?.uid

  useEffect(() => {
    if (!activeOwnerUid) return undefined
    const unsubInvitations = isPrimaryOwner
      ? subscribeToParentInvitations(activeOwnerUid, setInvitations)
      : () => setInvitations([])
    const unsubParents = subscribeToParentAccess(activeOwnerUid, setParents)
    return () => {
      unsubInvitations()
      unsubParents()
    }
  }, [activeOwnerUid, isPrimaryOwner])

  async function handleInvite(event) {
    event.preventDefault()
    setMessage('')
    setError('')
    setLoadingInvite(true)

    try {
      const result = await createParentInvitation(inviteEmail)
      setInviteEmail('')
      setMessage(
        result.accountCreated
          ? `Приглашение отправлено на ${result.email}. В письме будет временный пароль.`
          : `Приглашение отправлено на ${result.email}. Родитель войдет со своим текущим паролем.`
      )
    } catch (err) {
      setError(err.message || 'Не удалось отправить приглашение.')
    } finally {
      setLoadingInvite(false)
    }
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

      <div className="settings-subsection">
        <h3 className="subsection-title">Родители</h3>

        {isPrimaryOwner ? (
          <form className="settings-form parent-invite-form" onSubmit={handleInvite}>
            <div className="form-row two-cols">
              <div className="form-group">
                <label className="form-label">Email родителя</label>
                <input
                  className="input"
                  type="email"
                  placeholder="parent@example.com"
                  value={inviteEmail}
                  onChange={event => setInviteEmail(event.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary parent-invite-btn" disabled={loadingInvite} type="submit">
                {loadingInvite ? <span className="btn-spinner-sm" /> : 'Пригласить'}
              </button>
            </div>
            {message && <div className="settings-msg success">{message}</div>}
            {error && <div className="settings-msg error">{error}</div>}
          </form>
        ) : (
          <div className="settings-msg">
            Приглашать новых родителей может только владелец семейного аккаунта.
          </div>
        )}

        <div className="parents-list">
          <div className="parent-row">
            <div>
              <div className="parent-email">{user?.email}</div>
              <div className="parent-meta">Текущий аккаунт</div>
            </div>
            <span className="parent-status active">{accountRole === 'parent' ? 'Родитель' : 'Владелец'}</span>
          </div>

          {parents.map(parent => (
            <div className="parent-row" key={parent.id}>
              <div>
                <div className="parent-email">{parent.email}</div>
                <div className="parent-meta">Принято {formatDate(parent.acceptedAt)}</div>
              </div>
              <span className="parent-status active">{statusLabel(parent.status)}</span>
            </div>
          ))}

          {invitations.filter(invitation => invitation.status !== 'accepted').map(invitation => (
            <div className="parent-row" key={invitation.id}>
              <div>
                <div className="parent-email">{invitation.email}</div>
                <div className="parent-meta">Истекает {formatDate(invitation.expiresAt)}</div>
              </div>
              <span className={`parent-status ${invitation.status || 'pending'}`}>
                {statusLabel(invitation.status)}
              </span>
            </div>
          ))}
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
    </section>
  )
}
