import { useEffect, useState } from 'react'
import { applyActionCode } from 'firebase/auth'
import { auth } from '@kidscontrol/shared/firebase/config'

export default function EmailActionPage() {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  const oobCode = params.get('oobCode')

  const [status, setStatus] = useState(oobCode ? 'loading' : 'success')
  const [error, setError] = useState('')

  useEffect(() => {
    if (mode === 'verifyEmail' && oobCode) {
      applyActionCode(auth, oobCode)
        .then(() => setStatus('success'))
        .catch(err => {
          if (err.code === 'auth/invalid-action-code') {
            setError('Ссылка недействительна или уже была использована.')
          } else if (err.code === 'auth/expired-action-code') {
            setError('Ссылка устарела. Запросите новое письмо.')
          } else {
            setError(`Ошибка: ${err.message}`)
          }
          setStatus('error')
        })
    }
  }, [])

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ textAlign: 'center', padding: '40px 32px' }}>
        {status === 'loading' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⏳</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Подтверждаем email…
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Пожалуйста, подождите
            </div>
            <div className="splash-spinner" style={{ margin: '24px auto 0' }} />
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(32,201,151,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 36 }}>
              ✅
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10, letterSpacing: '-.02em' }}>
              Email подтверждён!
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
              Ваш аккаунт активирован. Теперь вы можете войти в KidsControlPC.
            </div>
            <a
              href="/"
              className="btn btn-primary auth-submit"
              style={{ textDecoration: 'none', display: 'block' }}
            >
              Войти в приложение →
            </a>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,77,109,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 36 }}>
              ❌
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10, letterSpacing: '-.02em' }}>
              Не удалось подтвердить
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
              {error}
            </div>
            <a
              href="/"
              className="btn btn-primary auth-submit"
              style={{ textDecoration: 'none', display: 'block' }}
            >
              Вернуться в приложение
            </a>
          </>
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
