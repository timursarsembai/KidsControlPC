import { useTranslation } from 'react-i18next'
import { signOut } from 'firebase/auth'
import { auth } from '@kidscontrol/shared/firebase/config'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

export default function AccountSection({ user }) {
  const { t } = useTranslation()
  const { accountRole } = useRulesStore()

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
