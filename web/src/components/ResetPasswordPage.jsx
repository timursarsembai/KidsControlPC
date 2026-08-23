import { useEffect, useState } from 'react'
import { resetPasswordWithToken } from '@kidscontrol/shared/data/auth'

/**
 * The page a recovery link opens: /reset-password?token=…
 *
 * On success the parent is signed in straight away — they arrived from their
 * own mailbox and have just proved they own the address, so asking them to
 * type the password they set five seconds ago would be ceremony.
 */
export default function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') || ''
    setToken(value)
    if (!value) setError('Ссылка неполная. Откройте её из письма целиком.')
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Пароль должен быть не менее 8 символов.')
      return
    }
    if (password !== confirm) {
      setError('Пароли не совпадают.')
      return
    }

    setSaving(true)
    try {
      await resetPasswordWithToken(token, password)
      setDone(true)
      // The token in the address bar is spent, but it should not sit in
      // history or get shared along with the link to the panel.
      window.history.replaceState({}, '', '/')
      setTimeout(() => { window.location.href = '/' }, 1200)
    } catch (err) {
      setError(
        err?.code === 'invalid_token'
          ? 'Ссылка недействительна или устарела. Запросите новую.'
          : err?.message || 'Не удалось задать пароль.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">🔑</span>
          <div>
            <div className="auth-logo-name">Новый пароль</div>
            <div className="auth-logo-sub">KidsControlPC</div>
          </div>
        </div>

        {done ? (
          <div className="auth-note" style={{ color: 'var(--success, #20c997)' }}>
            Пароль изменён. Открываем панель…
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <div className="form-group">
              <label className="form-label">Новый пароль</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Ещё раз</label>
              <input
                type="password"
                className="input"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <div className="auth-note" style={{ color: 'var(--danger)', marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button className="btn btn-primary auth-submit" type="submit" disabled={saving || !token}>
              {saving ? 'Сохранение...' : 'Задать пароль'}
            </button>
            <button
              className="btn auth-submit"
              type="button"
              style={{ marginTop: 8, background: 'transparent', color: 'var(--text-tertiary)', fontSize: 13 }}
              onClick={() => { window.location.href = '/' }}
            >
              Вернуться ко входу
            </button>
          </form>
        )}
      </div>
      <div className="auth-bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>
    </div>
  )
}
