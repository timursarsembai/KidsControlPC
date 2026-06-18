import { useTranslation } from 'react-i18next'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

export default function AccountSection({ user }) {
  const { t } = useTranslation()
  const { logout } = useRulesStore()

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">👤</div>
        <div>
          <h2 className="settings-section-title">{t('settings.account.title', 'Аккаунт')}</h2>
          <p className="settings-section-desc">{t('settings.account.desc', 'Управление профилем и настройками')}</p>
        </div>
      </div>

      <div className="account-card">
        <div className="account-info">
          <div className="account-avatar">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="account-details">
            <span className="account-email">{user?.email}</span>
            <span className="account-id">ID: {user?.uid.slice(0,8)}...</span>
          </div>
        </div>

        <button
          className="btn btn-danger"
          onClick={logout}
          style={{ width: '100%', marginTop: 20 }}
        >
          {t('settings.account.logout', 'Выйти из аккаунта')}
        </button>
      </div>
    </section>
  )
}
