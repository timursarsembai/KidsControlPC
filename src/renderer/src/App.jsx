import React, { useState, useEffect } from 'react'
import { auth } from './firebase/config'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from 'firebase/auth'
import { useRulesStore } from './stores/useRulesStore'
import Dashboard from './components/Dashboard/Dashboard'
import './App.css'

export default function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [mode, setMode]               = useState('login')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [error, setError]             = useState('')
  const [resetMsg, setResetMsg]       = useState('')
  const [loading, setLoading]         = useState(false)

  const { user, initFirebase, cleanup } = useRulesStore()

  // Listen to Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await initFirebase(firebaseUser)
      } else {
        cleanup()
      }
      setAuthLoading(false)
    })
    return unsub
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'register' && password !== confirmPwd) {
      setError('Пароли не совпадают')
      return
    }
    if (mode !== 'reset' && password.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else if (mode === 'register') {
        await createUserWithEmailAndPassword(auth, email, password)
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email)
        setResetMsg('Ссылка для сброса пароля отправлена на ' + email)
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
          >Войти</button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); setResetMsg('') }}
          >Создать аккаунт</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
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
            <label className="form-label">Пароль</label>
            <input
              type="password"
              className="input"
              placeholder="Минимум 6 символов"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'login' && (
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); setMode('reset'); setError(''); setResetMsg('') }} style={{ color: 'var(--brand-primary)', fontSize: 13, textDecoration: 'none' }}>
                  Забыли пароль?
                </a>
              </div>
            )}
          </div>
          )}

          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">Повторите пароль</label>
              <input
                type="password"
                className="input"
                placeholder="Повторите пароль"
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
              : mode === 'login' ? '→ Войти' : mode === 'register' ? '✓ Создать аккаунт' : 'Сбросить пароль'
            }
          </button>
        </form>

        {mode === 'register' && (
          <div className="auth-note">
            После регистрации вы сможете добавить ПК ребёнка через раздел настроек
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
