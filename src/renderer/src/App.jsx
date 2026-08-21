import React, { useState, useEffect } from 'react'
import { auth } from '@kidscontrol/shared/firebase/config'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  signOut
} from 'firebase/auth'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'
import Dashboard from './components/Dashboard/Dashboard'
import InviteAcceptance from '@kidscontrol/shared/ui/InviteAcceptance'
import { useTranslation } from 'react-i18next'
import './App.css'

export default function App() {
  const { t } = useTranslation()
  const [authLoading, setAuthLoading] = useState(true)
  const [mode, setMode]               = useState('login')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [error, setError]             = useState('')
  const [resetMsg, setResetMsg]       = useState('')
  const [loading, setLoading]           = useState(false)
  const [verifyPending, setVerifyPending] = useState(false)
  const [resendMsg, setResendMsg]         = useState('')

  const { user, initFirebase, cleanup } = useRulesStore()

  // Listen to Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (firebaseUser.emailVerified) {
          setVerifyPending(false)
          await initFirebase(firebaseUser)
        } else {
          setVerifyPending(true)
        }
      } else {
        setVerifyPending(false)
        cleanup()
      }
      setAuthLoading(false)
    })
    return unsub
  }, [initFirebase, cleanup])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'register' && password !== confirmPwd) {
      setError(t('auth.pwd_mismatch', 'Пароли не совпадают'))
      return
    }
    if (mode !== 'reset' && password.length < 6) {
      setError(t('auth.pwd_length', 'Пароль должен быть не менее 6 символов'))
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await sendEmailVerification(cred.user)
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email)
        setResetMsg(`Письмо отправлено на ${email}. Обязательно проверьте папку «Спам»!`)
      }
    } catch (err) {
      const msgs = {
        'auth/user-not-found':       'Пользователь не найден',
        'auth/wrong-password':       'Неверный пароль',
        'auth/email-already-in-use': 'Email уже зарегистрирован',
        'auth/invalid-email':        'Неверный формат email',
        'auth/invalid-credential':   'Неверный email или пароль',
      }
      setError(msgs[err.code] || `Ошибка: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await signOut(auth)
  }

  const handleResendVerification = async () => {
    setResendMsg('')
    try {
      await sendEmailVerification(auth.currentUser)
      setResendMsg(`Письмо отправлено на ${auth.currentUser.email}. Проверьте папку «Спам»!`)
    } catch {
      setResendMsg('Не удалось отправить письмо. Попробуйте позже.')
    }
  }

  const handleCheckVerified = async () => {
    setResendMsg('')
    try {
      await auth.currentUser.reload()
      if (auth.currentUser.emailVerified) {
        setVerifyPending(false)
        await initFirebase(auth.currentUser)
      } else {
        setResendMsg('Email ещё не подтверждён. Проверьте почту.')
      }
    } catch {
      setResendMsg('Не удалось проверить статус. Попробуйте ещё раз.')
    }
  }

  // ── Splash screen ──
  if (authLoading) {
    return (
      <div className="splash">
        <div className="splash-logo">🛡️</div>
        <div className="splash-name">KidsControl<span>PC</span></div>
        <div className="splash-spinner" />
      </div>
    )
  }

  // ── Invite acceptance (deep link: ?invitationId=...&token=...) ──
  if (new URLSearchParams(window.location.search).get('invitationId')) {
    return <InviteAcceptance user={user} />
  }

  // ── Email verification pending ──
  if (verifyPending) {
    return (
      <div className="auth-screen">
        <div className="auth-drag-region" />
        <div className="auth-card">
          <div className="auth-logo">
            <span className="auth-logo-icon">✉️</span>
            <div>
              <div className="auth-logo-name">Подтвердите email</div>
              <div className="auth-logo-sub">KidsControlPC</div>
            </div>
          </div>
          <div className="auth-note" style={{ marginBottom: 16 }}>
            Мы отправили письмо на <strong>{auth.currentUser?.email}</strong>. Перейдите по ссылке в письме, затем нажмите кнопку ниже.
          </div>
          {resendMsg && (
            <div className="auth-note" style={{ color: 'var(--success, #20c997)', backgroundColor: 'rgba(32,201,151,0.1)', borderColor: 'rgba(32,201,151,0.2)', marginBottom: 12 }}>
              {resendMsg}
            </div>
          )}
          <button className="btn btn-primary auth-submit" onClick={handleCheckVerified}>
            ✓ Я подтвердил email
          </button>
          <button className="btn auth-submit" style={{ marginTop: 8, background: 'var(--surface-2)', color: 'var(--text-secondary)' }} onClick={handleResendVerification}>
            Отправить письмо повторно
          </button>
          <button className="btn auth-submit" style={{ marginTop: 8, background: 'transparent', color: 'var(--text-tertiary)', fontSize: 13 }} onClick={handleSignOut}>
            Выйти
          </button>
        </div>
        <div className="auth-bg-orbs">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
        </div>
      </div>
    )
  }

  // ── Dashboard (logged in) ──
  if (user) return <Dashboard onSignOut={handleSignOut} />

  // ── Auth screen ──
  return (
    <div className="auth-screen">
      <div className="auth-drag-region" />

      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">🛡️</span>
          <div>
            <div className="auth-logo-name">KidsControl<span>PC</span></div>
            <div className="auth-logo-sub">Родительский контроль</div>
          </div>
        </div>

        <div className="auth-tab-switch">
          <button
            className={`auth-tab ${mode === 'login' || mode === 'reset' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); setResetMsg('') }}
          >{t('auth.login', 'Войти')}</button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); setResetMsg('') }}
          >{t('auth.register', 'Создать аккаунт')}</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('auth.email', 'Email')}</label>
            <input
              type="email"
              className="input"
              placeholder="parent@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {mode !== 'reset' && (
            <div className="form-group">
            <label className="form-label">{t('auth.password', 'Пароль')}</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'login' && (
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); setMode('reset'); setError(''); setResetMsg('') }} style={{ color: 'var(--brand-primary)', fontSize: 13, textDecoration: 'none' }}>
                  {t('auth.forgot_password', 'Забыли пароль?')}
                </a>
              </div>
            )}
          </div>
          )}

          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">{t('auth.confirm_password', 'Повторите пароль')}</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirmPwd}
                onChange={e => setConfirmPwd(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}
          {resetMsg && <div className="auth-note" style={{ color: 'var(--success, #20c997)', backgroundColor: 'rgba(32, 201, 151, 0.1)', borderColor: 'rgba(32, 201, 151, 0.2)' }}>{resetMsg}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading
              ? <span className="btn-spinner" />
              : mode === 'login' ? t('auth.submit_login', '→ Войти') : mode === 'register' ? t('auth.submit_register', '✓ Создать аккаунт') : t('auth.submit_reset', 'Сбросить пароль')
            }
          </button>
        </form>

        {mode === 'register' && (
          <div className="auth-note">
            {t('auth.register_note', 'После регистрации вы сможете добавить ПК ребёнка через раздел настроек')}
          </div>
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

