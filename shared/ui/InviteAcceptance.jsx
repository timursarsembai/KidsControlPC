import React, { useEffect, useMemo, useState } from 'react'
import {
  changePassword,
  requiresCurrentPasswordToChange,
  signIn,
  signOutUser
} from '@kidscontrol/shared/data/auth'
import {
  acceptParentInvitation,
  declineParentInvitation,
  getParentInvitation
} from '@kidscontrol/shared/data/parents'

export default function InviteAcceptance({ user }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const invitationId = params.get('invitationId')
  const token = params.get('token')
  const [invitation, setInvitation] = useState(null)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [stage, setStage] = useState('review')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadInvitation() {
      if (!invitationId || !token) {
        setLoadError('Ссылка приглашения неполная или повреждена.')
        setLoading(false)
        return
      }

      try {
        const data = await getParentInvitation(invitationId, token)
        if (!cancelled) setInvitation(data)
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Не удалось открыть приглашение.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadInvitation()
    return () => {
      cancelled = true
    }
  }, [invitationId, token])

  const invitedEmail = invitation?.email || ''
  const signedInAsInvitee = user?.email?.toLowerCase() === invitedEmail.toLowerCase()
  const needsPassword = !signedInAsInvitee

  async function handleAccept(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (!signedInAsInvitee) {
        if (user) await signOutUser()
        await signIn(invitedEmail, password)
      }

      const result = await acceptParentInvitation(invitationId, token)
      if (result.requiresPasswordChange) {
        setStage('password')
      } else {
        window.location.assign('/')
      }
    } catch (err) {
      setError(err.message || 'Не удалось принять приглашение.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDecline() {
    setError('')
    setSubmitting(true)

    try {
      await declineParentInvitation(invitationId, token)
      setStage('declined')
    } catch (err) {
      setError(err.message || 'Не удалось отклонить приглашение.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault()
    setError('')

    if (newPassword.length < 6) {
      setError('Новый пароль должен быть не короче 6 символов.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают.')
      return
    }

    setSubmitting(true)
    try {
      // The self-hosted backend asks for the current password; on Firebase it
      // relies on the sign-in that just happened a moment ago. Either way the
      // parent has just typed the temporary one from the invitation letter.
      await changePassword(requiresCurrentPasswordToChange ? password : undefined, newPassword)
      window.location.assign('/')
    } catch (err) {
      setError(err.message || 'Не удалось сменить пароль.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card invite-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">🛡️</span>
          <div>
            <div className="auth-logo-name">KidsControl<span>PC</span></div>
            <div className="auth-logo-sub">Приглашение родителя</div>
          </div>
        </div>

        {loading && <div className="auth-note">Проверяем приглашение...</div>}

        {!loading && loadError && <div className="auth-error">{loadError}</div>}

        {!loading && !loadError && stage === 'declined' && (
          <div className="auth-note invite-note">
            Приглашение отклонено. Временный аккаунт и приглашение будут удалены автоматически.
          </div>
        )}

        {!loading && !loadError && stage === 'password' && (
          <form className="auth-form" onSubmit={handlePasswordChange}>
            <div className="auth-note invite-note">
              Доступ подтверждён. Теперь задайте новый пароль для аккаунта {invitedEmail}.
            </div>
            <div className="form-group">
              <label className="form-label">Новый пароль</label>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Повторите пароль</label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="btn btn-primary auth-submit" disabled={submitting} type="submit">
              {submitting ? <span className="btn-spinner" /> : 'Сохранить пароль'}
            </button>
          </form>
        )}

        {!loading && !loadError && stage === 'review' && invitation && (
          <form className="auth-form" onSubmit={handleAccept}>
            <div className="invite-summary">
              <div className="invite-summary-label">Владелец</div>
              <div className="invite-summary-value">{invitation.ownerEmail || 'KidsControlPC'}</div>
              <div className="invite-summary-label">Ваш email</div>
              <div className="invite-summary-value">{invitedEmail}</div>
            </div>

            <div className="auth-note invite-note">
              Приняв приглашение, вы получите доступ к управлению устройствами семьи.
            </div>

            {needsPassword && (
              <div className="form-group">
                <label className="form-label">Пароль из письма</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}

            <button className="btn btn-primary auth-submit" disabled={submitting} type="submit">
              {submitting ? <span className="btn-spinner" /> : 'Принять и продолжить'}
            </button>
            <button className="btn btn-ghost" disabled={submitting} onClick={handleDecline} type="button">
              Отклонить приглашение
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
